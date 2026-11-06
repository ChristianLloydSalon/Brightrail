import { describe, expect, it } from "vitest";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { TEMPLATES } from "@/lib/templates";
import type { Connection, WorkflowDefinition } from "./types";
import { can, DEFAULT_GRANTS, assignableRoles } from "./permissions";
import { redact, REDACTED } from "./redaction";
import { checkOutboundUrl, isPrivateAddress } from "./url-safety";
import { checksum, validateWorkflow } from "./validation";

const conn = (id: string, integrationId: string, status: Connection["status"] = "connected") => ({ id, integrationId, status, displayName: id });
const ctx = { connections: [conn("c_slack", "int_slack"), conn("c_discord", "int_discord"), conn("c_resend", "int_resend"), conn("c_old", "int_slack", "revoked")], integrations: INTEGRATIONS };
const tpl = (id: string): WorkflowDefinition => TEMPLATES.find((t) => t.id === id)!.build();
const withConn = (def: WorkflowDefinition, connectionId: string) => {
  for (const n of def.nodes) if (n.kind === "action") n.config.connectionId = connectionId;
  return def;
};

describe("validateWorkflow", () => {
  it("flags the missing connection in a fresh template, then passes once one is chosen", () => {
    const fresh = validateWorkflow(tpl("form-to-slack"), ctx);
    expect(fresh.errors.some((e) => e.field === "connectionId")).toBe(true);
    expect(validateWorkflow(withConn(tpl("form-to-slack"), "c_slack"), ctx).valid).toBe(true);
  });
  it("every template is valid once connections are chosen", () => {
    expect(validateWorkflow(withConn(tpl("welcome-email"), "c_resend"), ctx).errors).toEqual([]);
    expect(validateWorkflow(withConn(tpl("api-to-discord"), "c_discord"), ctx).errors).toEqual([]);
  });
  it("rejects revoked connections, cycles, missing triggers and empty steps", () => {
    expect(validateWorkflow(withConn(tpl("form-to-slack"), "c_old"), ctx).errors.some((e) => e.code === "CONNECTION")).toBe(true);
    const loop = withConn(tpl("welcome-email"), "c_resend");
    loop.edges.push({ id: "loop", source: "n_email", target: "n_wait", sourceHandle: "default" });
    expect(validateWorkflow(loop, ctx).errors.some((e) => e.code === "CYCLE")).toBe(true);
    expect(validateWorkflow({ nodes: [], edges: [] }, ctx).errors[0]!.code).toBe("EMPTY");
    expect(validateWorkflow(tpl("blank"), ctx).errors.some((e) => e.code === "NO_STEPS")).toBe(true);
  });
  it("blocks unsafe HTTP URLs", () => {
    const def = tpl("api-to-discord");
    const http = def.nodes.find((n) => n.kind === "http")!;
    if (http.kind === "http") http.config.url = "https://169.254.169.254/latest/meta-data";
    expect(validateWorkflow(withConn(def, "c_discord"), ctx).errors.some((e) => e.code === "UNSAFE_URL")).toBe(true);
  });
  it("checksum ignores layout", () => {
    const a = tpl("welcome-email"), b = tpl("welcome-email");
    b.nodes[0]!.position = { x: 999, y: 1 };
    expect(checksum(a)).toBe(checksum(b));
  });
});

describe("SSRF protection", () => {
  it.each(["http://api.example.com", "https://localhost/x", "https://127.0.0.1", "https://10.0.0.5", "https://169.254.169.254/latest", "https://192.168.1.1", "https://user:pw@api.example.com", "https://intranet"])("blocks %s", (u) => {
    expect(checkOutboundUrl(u).ok).toBe(false);
  });
  it("allows public https with templates", () => expect(checkOutboundUrl("https://api.example.com/orders/{{orderId}}").ok).toBe(true));
  it("blocks private addresses after DNS resolution", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "::1", "fd00::1", "::ffff:192.168.0.10", "169.254.169.254"]) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("140.82.112.3")).toBe(false);
  });
});

describe("redact", () => {
  it("removes secrets and masks personal data", () => {
    const out = redact({ apiKey: "re_123", customerEmail: "lin.wei@example.test", nested: { authorization: "Bearer x" }, list: [{ password: "p" }] }) as Record<string, unknown>;
    expect(out.apiKey).toBe(REDACTED);
    expect(out.customerEmail).toBe("l•••@example.test");
    expect((out.nested as Record<string, unknown>).authorization).toBe(REDACTED);
    expect((out.list as Array<Record<string, unknown>>)[0]!.password).toBe(REDACTED);
  });
});

describe("permissions", () => {
  it("follows the spec role matrix", () => {
    expect(can("viewer", "runs.retry")).toBe(false);
    expect(can("operator", "runs.retry")).toBe(true);
    expect(can("editor", "workflows.publish", DEFAULT_GRANTS)).toBe(true);
    expect(can("editor", "workflows.publish", { "editor:workflows.publish": false })).toBe(false);
    expect(can("admin", "workspace.delete")).toBe(false);
    expect(can(null, "workflows.view")).toBe(false);
    expect(assignableRoles("admin")).not.toContain("admin");
  });
});
