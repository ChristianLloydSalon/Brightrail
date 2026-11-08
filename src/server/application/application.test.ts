// @vitest-environment node
// Use-case tests with in-memory fakes: the application layer depends only on ports, so no database,
// queue or network is needed to exercise its rules.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-error";
import { DEFAULT_GRANTS } from "@/lib/domain/permissions";
import { retryBlockReason, stepsForCancel } from "@/lib/domain/run-rules";
import type { Member, StepRun, WebhookEndpoint, WorkflowRun, Workspace } from "@/lib/domain/types";
import { WebhookIngestService } from "./integrations/webhook-ingest-service";
import type { DeliveryRepository, RunRepository, WebhookRepository, WorkflowRepository } from "./ports/repositories";
import type { AppConfig, EventBus, Hasher, RateLimiter, SecretStore } from "./ports/services";
import type { RunLauncher } from "./runs/run-launcher";
import { RunResumer } from "./runs/run-service";
import { RequestContext } from "./shared/context";

const hasher: Hasher = {
  sha256: (v) => createHash("sha256").update(v).digest("hex"),
  hmacSha256Hex: (s, v) => createHmac("sha256", s).update(v).digest("hex"),
  safeEqual: (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)),
  randomToken: (p) => `${p}token`,
};
const config: AppConfig = { appUrl: "https://app.example", emailNotificationsAvailable: false, production: true };

const workspace = { id: "ws1", name: "Acme", grants: DEFAULT_GRANTS, settings: {}, quotas: { executionsPerMonth: 10, members: 5, connections: 5 } } as unknown as Workspace;
const contextFor = (role: Member["role"]) => new RequestContext({ id: "u1", email: "a@b.co", name: "Ada" }, { id: "m1", workspaceId: "ws1", userId: "u1", name: "Ada", email: "a@b.co", role, status: "active" }, workspace);

describe("RequestContext", () => {
  it("applies the role's permissions and the workspace's grants", () => {
    expect(contextFor("viewer").can("workflows.view")).toBe(true);
    expect(() => contextFor("viewer").require("workflows.edit")).toThrow(/Your role \(viewer\)/);
    expect(contextFor("editor").can("workflows.publish")).toBe(true); // granted by default
    expect(contextFor("editor").can("runs.retry")).toBe(false);
  });
});

describe("run rules", () => {
  it("refuses retries that can't succeed", () => {
    expect(retryBlockReason({ errorClass: "permission" })).toMatch(/Fix the connection/);
    expect(retryBlockReason({ errorClass: "validation" })).toMatch(/failed validation/);
    expect(retryBlockReason({ errorClass: "transient" })).toBeNull();
  });

  it("cancels only unfinished steps", () => {
    const step = (status: StepRun["status"]) => ({ id: status, status }) as StepRun;
    const out = stepsForCancel([step("succeeded"), step("running"), step("pending")], "T");
    expect(out.map((s) => [s.status, s.endedAt])).toEqual([["succeeded", undefined], ["cancelled", "T"], ["cancelled", undefined]]);
  });
});

describe("RunResumer", () => {
  const run = { id: "r1", status: "failed", logs: [], steps: [{ id: "s1", nodeId: "n1", nodeLabel: "Call API", status: "failed" }] } as unknown as WorkflowRun;

  it("claims the next pass and dispatches with a deterministic event id", async () => {
    const sent: Array<[unknown, string | undefined]> = [];
    const runs = { passOf: async () => ({ pass: 2, status: "failed" }), claimPass: async () => true } as unknown as RunRepository;
    const bus = { requestRun: async (d: unknown, id?: string) => void sent.push([d, id]) } as unknown as EventBus;
    await new RunResumer(runs, bus).resume(contextFor("admin"), run, "s1", "Manual retry");
    expect(sent).toEqual([[{ runId: "r1", pass: 3, resumeFromNodeId: "n1" }, "r1:p3"]]);
  });

  it("stops without dispatching when someone else claimed the pass first", async () => {
    let dispatched = false;
    const runs = { passOf: async () => ({ pass: 0, status: "failed" }), claimPass: async () => false } as unknown as RunRepository;
    const bus = { requestRun: async () => void (dispatched = true) } as unknown as EventBus;
    await expect(new RunResumer(runs, bus).resume(contextFor("admin"), run, "s1", "x")).rejects.toThrow(/just retried by someone else/);
    expect(dispatched).toBe(false);
  });
});

describe("WebhookIngestService", () => {
  const endpoint: WebhookEndpoint = {
    id: "00000000-0000-0000-0000-0000000000e1", workspaceId: "ws1", workflowId: "wf1", name: "Orders", status: "active", signingSecretRef: "", secretHint: "",
    replayWindowSec: 300, maxBodyKb: 64, rateLimitPerMin: 60, verification: "hmac", headerKeyOnly: false, createdAt: "",
  };
  let recorded: string[];
  let started: unknown[];
  let secret: string | null;

  const service = () => {
    const webhooks = { findById: async () => endpoint } as unknown as WebhookRepository;
    const deliveries = {
      record: async (r: { status: string }) => void recorded.push(r.status),
      acceptedRunByEvent: async () => null, acceptedRunBySignature: async () => null,
      insertAccepted: async () => "d1", attachRun: async () => undefined, delete: async () => undefined,
    } as unknown as DeliveryRepository;
    const workflows = { runnable: async () => ({ id: "wf1", name: "Orders", status: "active", currentVersionId: "v1" }) } as unknown as WorkflowRepository;
    const secrets: SecretStore = { read: async () => secret, write: async () => undefined, remove: async () => undefined };
    const limiter: RateLimiter = { hit: async () => ({ count: 1 }), webhookHit: async () => ({ count: 1 }) };
    const launcher = { start: async (cmd: unknown) => (started.push(cmd), { id: "run1" }) } as unknown as RunLauncher;
    return new WebhookIngestService(webhooks, deliveries, workflows, secrets, hasher, limiter, launcher, config);
  };
  const signed = (body: string, key: string, ts = Math.floor(Date.now() / 1000)) =>
    new Headers({ "content-type": "application/json", "x-brightrail-timestamp": String(ts), "x-brightrail-signature": `sha256=${hasher.hmacSha256Hex(key, `${ts}.${body}`)}` });

  beforeEach(() => {
    recorded = [];
    started = [];
    secret = "whsec_real";
  });

  it("accepts a correctly signed delivery and starts the run", async () => {
    const body = '{"order":1}';
    const res = await service().ingest(endpoint.id, body, signed(body, "whsec_real"));
    expect(res).toMatchObject({ status: 202, body: { accepted: true, runId: "run1" } });
    expect(started).toHaveLength(1);
  });

  it("rejects a bad signature and logs it", async () => {
    const res = await service().ingest(endpoint.id, "{}", signed("{}", "wrong"));
    expect(res.status).toBe(401);
    expect(recorded).toEqual(["rejected_signature"]);
    expect(started).toHaveLength(0);
  });

  it("never verifies against an empty key when the stored secret is missing", async () => {
    secret = null;
    const res = await service().ingest(endpoint.id, "{}", signed("{}", ""));
    expect(res).toMatchObject({ status: 401, body: { code: "BAD_SIGNATURE" } });
    expect(started).toHaveLength(0);
  });

  it("rejects timestamps outside the replay window", async () => {
    const res = await service().ingest(endpoint.id, "{}", signed("{}", "whsec_real", Math.floor(Date.now() / 1000) - 3600));
    expect(res).toMatchObject({ status: 401, body: { code: "REPLAY_WINDOW" } });
    expect(recorded).toEqual(["rejected_replay"]);
  });

  it("releases the idempotency record when the run can't start", async () => {
    const svc = service();
    (svc as unknown as { launcher: RunLauncher }).launcher.start = async () => { throw new ApiError("RATE_LIMITED", "Quota used."); };
    const res = await svc.ingest(endpoint.id, "{}", signed("{}", "whsec_real"));
    expect(res).toMatchObject({ status: 429, body: { code: "QUOTA_EXCEEDED" } });
    expect(recorded).toEqual(["not_started"]);
  });
});
