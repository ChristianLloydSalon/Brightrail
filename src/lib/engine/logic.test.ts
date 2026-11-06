import { describe, expect, it } from "vitest";
import { analyzeFailure, checkPolicy } from "@/lib/ai/advisor";
import { DEFAULT_GRANTS } from "@/lib/domain/permissions";
import type { StepRun, WorkflowRun } from "@/lib/domain/types";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { TEMPLATES } from "@/lib/templates";
import { applyTransform, backoffSeconds, classifyHttpStatus, evalCondition, fillTemplate, idempotencyKey, resolveValue } from "./logic";

describe("execution helpers", () => {
  const data = { name: "Ada", order: { total: 42 }, tags: ["vip"] };
  it("fills templates and resolves mapping values", () => {
    expect(fillTemplate("Hi {{name}}, total {{order.total}}{{missing}}", data)).toBe("Hi Ada, total 42");
    expect(resolveValue("order.total", data)).toBe(42);
    expect(resolveValue("New order from {{name}}", data)).toBe("New order from Ada");
    expect(resolveValue("plain words here", data)).toBe("plain words here");
  });
  it("evaluates conditions", () => {
    expect(evalCondition({ field: "order.total", operator: "greater_than", value: "10" }, data)).toBe(true);
    expect(evalCondition({ field: "tags", operator: "contains", value: "vip" }, data)).toBe(true);
    expect(evalCondition({ field: "nope", operator: "exists", value: "" }, data)).toBe(false);
  });
  it("applies safe transforms", () => {
    const d: Record<string, unknown> = { email: " A@B.TEST " };
    applyTransform({ mappings: [{ source: "email", target: "clean.email", fn: "trim" }, { source: "missing", target: "plan", fn: "default", fallback: "free" }] }, d);
    expect(d).toMatchObject({ clean: { email: "A@B.TEST" }, plan: "free" });
  });
  it("keeps idempotency keys stable and backoff bounded", () => {
    expect(idempotencyKey("r1", "n1")).toBe(idempotencyKey("r1", "n1"));
    expect(idempotencyKey("r1", "n1")).not.toBe(idempotencyKey("r2", "n1"));
    expect([1, 2, 3, 10].map((a) => backoffSeconds(a))).toEqual([2, 4, 8, 60]);
  });
  it("classifies HTTP failures", () => {
    expect(classifyHttpStatus(503, "X").retryable).toBe(true);
    expect(classifyHttpStatus(429, "X").errorClass).toBe("transient");
    expect(classifyHttpStatus(401, "X").errorClass).toBe("permission");
    expect(classifyHttpStatus(422, "X").retryable).toBe(false);
  });
});

describe("AI advisor policy", () => {
  const def = TEMPLATES.find((t) => t.id === "welcome-email")!.build();
  const failed: StepRun = { id: "s_email", runId: "r1", nodeId: "n_email", nodeLabel: "Send welcome email", nodeKind: "action", status: "failed", attempt: 3, errorCode: "PROVIDER_TIMEOUT", errorClass: "transient", errorMessage: "timeout", attempts: [1, 2, 3].map((a) => ({ attempt: a, status: "failed" as const, startedAt: "", idempotencyKey: "k1", errorCode: "PROVIDER_TIMEOUT" })) };
  const run = { id: "r1", workflowName: "Welcome", version: 1, status: "failed", steps: [failed], workflowVersionId: "v1" } as unknown as WorkflowRun;
  it("recommends an approval-gated retry for idempotent transient failures", () => {
    const a = analyzeFailure({ run, step: failed, node: def.nodes.find((n) => n.id === "n_email"), integrations: INTEGRATIONS, connections: [], actor: { id: "u", role: "operator" }, grants: DEFAULT_GRANTS, aiEnabled: true });
    expect(a.recommendation.actionType).toBe("retry_failed_step");
    expect(a.policy).toMatchObject({ allowed: true, requiresApproval: true });
  });
  it("rejects actions outside the catalogue and when AI is off", () => {
    expect(checkPolicy({ actionType: "run_sql", actor: { role: "owner" }, grants: DEFAULT_GRANTS, aiEnabled: true, run, step: failed }).allowed).toBe(false);
    expect(checkPolicy({ actionType: "retry_failed_step", actor: { role: "owner" }, grants: DEFAULT_GRANTS, aiEnabled: false, run, step: failed }).allowed).toBe(false);
  });
});

describe("field paths can't reach prototypes", () => {
  it("blocks __proto__/constructor in reads, writes and templates", async () => {
    const { applyTransform, fillTemplate } = await import("./logic");
    const { getPath, setPath } = await import("@/lib/utils");
    expect(() => applyTransform({ mappings: [{ target: "__proto__.polluted", source: "a", fn: "copy" }] }, { a: 1 })).toThrow(/allowed field/);
    expect(() => setPath({}, "x.constructor.prototype.polluted", 1)).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(getPath({ a: {} }, "a.constructor")).toBeUndefined();
    expect(getPath({}, "toString")).toBeUndefined();
    expect(fillTemplate("{{constructor.name}}", {})).toBe("");
  });
});
