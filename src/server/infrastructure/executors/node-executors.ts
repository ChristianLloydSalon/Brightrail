import "server-only";
import { REDACTED, redact } from "@/lib/domain/redaction";
import type { Connection, JsonValue, NodeKind, NodeOf, WorkflowNode } from "@/lib/domain/types";
import { evalFormula } from "@/lib/engine/formula";
import { applyTransform, evalCondition, fillJsonTemplate, fillTemplate, idempotencyKey, resolveValue, type StepFailure } from "@/lib/engine/logic";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { getPath, setPath } from "@/lib/utils";
import type { ConnectionRepository } from "@/server/application/ports/repositories";
import type { ExecResult, NodeExecutor, RunRef, SecretStore } from "@/server/application/ports/services";
import { ACTION_HANDLERS } from "./action-handlers";
import { send, withinBase } from "./outbound";

export { withinBase };

/**
 * Activity implementations (spec §06 "Activity workers"). Each call performs at most one external
 * side effect and returns a JSON-safe, redacted result. Secrets are decrypted inside the call and
 * never returned, so they never reach Inngest's step history or the database.
 */

const fail = (input: JsonValue, code: string, message: string, errorClass: StepFailure["errorClass"]): ExecResult => ({ ok: false, input, failure: { code, message, errorClass, retryable: false } });
const keyFor = (run: RunRef, nodeId: string) => idempotencyKey(run.id, run.scope ? `${nodeId}@${run.scope}` : nodeId);

/**
 * Loads a connection only if it belongs to the run's workspace AND is of the integration the step expects,
 * so an HTTP step can't borrow (and leak) a Slack/Resend/Notion/… credential, and vice versa.
 */
export class CredentialBinder {
  constructor(
    private readonly connections: ConnectionRepository,
    private readonly secrets: SecretStore,
  ) {}

  async load(id: string | undefined, workspaceId: string, integrationId: string): Promise<{ conn: Connection; secret: string } | null> {
    if (!id) return null;
    const conn = await this.connections.findForExecution(id, workspaceId, integrationId);
    if (!conn) return null;
    return { conn, secret: (await this.secrets.read(id)) ?? "" };
  }
}

/** Strategy for one node kind. `data` is a private working copy the strategy may change. */
interface KindExecutor<K extends NodeKind> {
  execute(node: NodeOf<K>, data: Record<string, unknown>, run: RunRef): Promise<ExecResult> | ExecResult;
}
type Strategies = { [K in NodeKind]: KindExecutor<K> };

const trigger: KindExecutor<"trigger"> = {
  execute(node, data) {
    const input = redact(data.trigger as JsonValue);
    const missing = node.config.requiredFields.filter((f) => getPath(data.trigger, f) === undefined || getPath(data.trigger, f) === "");
    if (missing.length) return fail(input, "VALIDATION_MISSING_FIELD", `The trigger payload is missing: ${missing.join(", ")}.`, "validation");
    return { ok: true, input, output: input, data };
  },
};

const transform: KindExecutor<"transform"> = {
  execute(node, data) {
    const out = applyTransform(node.config, data);
    return { ok: true, input: redact(Object.fromEntries(node.config.mappings.map((m) => [m.source, (getPath(data, m.source) ?? null) as JsonValue]))), output: redact(out as JsonValue), data };
  },
};

const condition: KindExecutor<"condition"> = {
  execute(node, data) {
    const result = evalCondition(node.config, data);
    const branch = result ? "true" : "false";
    return { ok: true, input: redact({ field: node.config.field, actual: (getPath(data, node.config.field) ?? null) as JsonValue }), output: { result, branch }, branch, data };
  },
};

const delay: KindExecutor<"delay"> = {
  execute: (node, data) => ({ ok: true, input: { amount: node.config.amount, unit: node.config.unit }, output: { resumedAt: new Date().toISOString() }, data }),
};

const errorHandler: KindExecutor<"errorHandler"> = {
  execute: (node, data) => ({ ok: true, input: null, output: { strategy: node.config.strategy }, data }),
};

const loop: KindExecutor<"loop"> = {
  execute(node, data) {
    const list = getPath(data, node.config.field);
    const input = { field: node.config.field };
    if (!Array.isArray(list))
      return fail(input, "LOOP_NOT_A_LIST", `“${node.config.field}” isn't a list${list === undefined ? " (the field doesn't exist)" : ""}. Point For each at a list such as items or order.lines.`, "validation");
    const count = Math.min(list.length, node.config.maxItems);
    return { ok: true, input, output: { items: list.length, processed: count, skipped: list.length - count }, data };
  },
};

const formula: KindExecutor<"formula"> = {
  execute(node, data) {
    const out: Record<string, unknown> = {};
    const input = redact(Object.fromEntries(node.config.assignments.filter((a) => a.target).map((a) => [a.target, a.expression])) as JsonValue);
    for (const a of node.config.assignments) {
      if (!a.target.trim()) continue;
      try {
        const v = evalFormula(a.expression, data);
        setPath(data, a.target, v);
        out[a.target] = v;
      } catch (e) {
        return fail(input, "FORMULA_ERROR", `${a.target}: ${(e as Error).message}`, "validation");
      }
    }
    return { ok: true, input, output: redact(out as JsonValue), data };
  },
};

const AUTH_HEADERS = new Set(["authorization", "x-api-key"]);

class HttpExecutor implements KindExecutor<"http"> {
  constructor(private readonly credentials: CredentialBinder) {}

  async execute(node: NodeOf<"http">, data: Record<string, unknown>, run: RunRef): Promise<ExecResult> {
    const c = node.config;
    // Run data is percent-encoded into the URL so it can't add path segments, a query or a fragment.
    const url = fillTemplate(c.url, data, encodeURIComponent);
    const shown = { method: c.method, url };
    const headers: Record<string, string> = Object.fromEntries(c.headers.filter((h) => h.key).map((h) => [h.key, fillTemplate(h.value, data)]));
    const badHeader = Object.entries(headers).find(([, v]) => /[\u0000-\u0008\u000a-\u001f\u007f]/.test(v));
    if (badHeader) return fail(shown, "VALIDATION_HEADER", `Header “${badHeader[0]}” would contain a line break or control character from run data.`, "validation");
    if (c.useIdempotencyKey) headers["Idempotency-Key"] = keyFor(run, node.id);
    const loaded = await this.credentials.load(c.connectionId, run.workspaceId, "int_http");
    if (c.connectionId && !loaded) return fail(shown, "CONNECTION_NOT_FOUND", "The selected connection no longer exists or isn't an HTTP Request connection.", "configuration");
    let authHeader: string | null = null;
    if (loaded) {
      if (loaded.conn.status === "revoked") return fail(shown, "CONNECTION_REVOKED", `Connection “${loaded.conn.displayName}” was revoked.`, "permission");
      const base = String(loaded.conn.config?.baseUrl ?? "");
      // An HTTP connection without a base URL would be an unrestricted credential: refuse it.
      if (!base || !withinBase(url, base)) return fail(shown, "URL_OUTSIDE_CONNECTION", base ? `This connection only allows URLs under ${base}.` : "This connection has no base URL. Edit it and set one.", "configuration");
      const configured = String(loaded.conn.config?.authHeader ?? "Authorization");
      authHeader = AUTH_HEADERS.has(configured.toLowerCase()) ? configured : "Authorization";
      headers[authHeader] = authHeader.toLowerCase() === "authorization" ? `Bearer ${loaded.secret}` : loaded.secret;
    }
    let body: string | undefined;
    if (c.method !== "GET" && c.method !== "DELETE" && c.body?.trim()) {
      body = fillJsonTemplate(c.body, data);
      headers["Content-Type"] ??= "application/json";
    }
    // The injected credential is always masked in the recorded step input, whatever the header is called.
    const shownHeaders = authHeader ? { ...headers, [authHeader]: REDACTED } : headers;
    const input = redact({ method: c.method, url, headers: shownHeaders, body: body ?? null } as JsonValue);
    const res = await send(url, { method: c.method, headers, body, timeoutSec: c.timeoutSec }, new URL(url).hostname);
    data.status = res.status;
    data.body = res.body;
    setPath(data, `steps.${node.id}`, res);
    return { ok: true, input, output: redact(res as unknown as JsonValue), data };
  }
}

class ActionExecutor implements KindExecutor<"action"> {
  constructor(private readonly credentials: CredentialBinder) {}

  async execute(node: NodeOf<"action">, data: Record<string, unknown>, run: RunRef): Promise<ExecResult> {
    const c = node.config;
    const integ = INTEGRATIONS.find((i) => i.id === c.integrationId);
    const action = integ?.actions.find((a) => a.key === c.actionKey);
    const mapped: Record<string, unknown> = {};
    for (const m of c.inputMapping) if (m.field) mapped[m.field] = resolveValue(m.source, data);
    const input = redact(mapped as JsonValue, action?.sensitiveFields ?? []);
    if (!integ || !action) return fail(input, "ACTION_NOT_FOUND", "The selected integration action doesn't exist.", "configuration");
    const loaded = await this.credentials.load(c.connectionId, run.workspaceId, integ.id);
    if (!loaded) return fail(input, "CONNECTION_NOT_FOUND", `Choose a ${integ.name} connection for this step.`, "configuration");
    if (loaded.conn.status === "revoked") return fail(input, "CONNECTION_REVOKED", `Connection “${loaded.conn.displayName}” was revoked.`, "permission");
    const handler = c.actionKey ? ACTION_HANDLERS[c.actionKey] : undefined;
    if (!handler) return fail(input, "ACTION_NOT_SUPPORTED", `${action.name} isn't supported yet.`, "configuration");
    const outcome = await handler.run({
      config: c, mapped, connection: loaded.conn, secret: loaded.secret, idempotencyKey: keyFor(run, node.id),
      text: String(mapped.text ?? mapped.message ?? "").slice(0, 3900), timeoutMs: c.timeoutSec * 1000,
    });
    if ("failure" in outcome) return { ok: false, input, failure: outcome.failure };
    setPath(data, `steps.${node.id}`, outcome.output);
    return { ok: true, input, output: redact(outcome.output as JsonValue, action.sensitiveFields), data };
  }
}

/** Dispatches each node to the strategy for its kind and turns thrown StepFailures into results. */
export class WorkflowNodeExecutor implements NodeExecutor {
  private readonly strategies: Strategies;

  constructor(credentials: CredentialBinder) {
    this.strategies = { trigger, transform, condition, delay, errorHandler, loop, formula, http: new HttpExecutor(credentials), action: new ActionExecutor(credentials) };
  }

  async execute(node: WorkflowNode, data: Record<string, unknown>, run: RunRef): Promise<ExecResult> {
    const working = structuredClone(data);
    try {
      return await (this.strategies[node.kind] as KindExecutor<NodeKind>).execute(node as never, working, run);
    } catch (e) {
      const failure = (e as { failure?: StepFailure }).failure ?? { code: "INTERNAL_ERROR", message: (e as Error).message, errorClass: "unknown", retryable: false };
      return { ok: false, input: null, failure };
    }
  }
}
