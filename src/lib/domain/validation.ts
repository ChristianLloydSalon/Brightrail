import { DELAY_LIMIT_SECONDS, NODE_META, UNIT_SECONDS } from "./nodes";
import { checkFormula } from "@/lib/engine/formula";
import { checkSchedule } from "@/lib/engine/schedule";
import type { Connection, Integration, WorkflowDefinition, WorkflowNode } from "./types";
import { checkOutboundUrl } from "./url-safety";

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  id: string;
  severity: IssueSeverity;
  code: string;
  message: string;
  nodeId?: string;
  field?: string;
}

export interface ValidationContext {
  connections: Pick<Connection, "id" | "integrationId" | "status" | "displayName">[];
  integrations: Pick<Integration, "id" | "actions" | "availability" | "name">[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  issues: ValidationIssue[];
  checkedAt: string;
}

const FIELD_PATH = /^(?!.*(?:^|\.)(?:__proto__|constructor|prototype)(?:\.|\[|$))[A-Za-z_][\w]*(\.[A-Za-z_][\w]*|\[\d+\])*$/;

/**
 * Validates graph shape and node configuration (spec FR-04, M2 "valid graph compiles").
 * Pure and deterministic so the API can run the same rules before publishing.
 */
export function validateWorkflow(def: WorkflowDefinition, ctx: ValidationContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  let seq = 0;
  const add = (i: Omit<ValidationIssue, "id">) => issues.push({ ...i, id: `${i.code}-${i.nodeId ?? "graph"}-${i.field ?? ""}-${seq++}` });

  const nodes = def.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  if (nodes.length === 0) {
    add({ severity: "error", code: "EMPTY", message: "Add a trigger to start building this workflow." });
    return finish(issues);
  }

  const triggers = nodes.filter((n) => n.kind === "trigger");
  if (triggers.length === 0) add({ severity: "error", code: "NO_TRIGGER", message: "The workflow needs exactly one trigger." });
  if (triggers.length > 1)
    triggers.slice(1).forEach((t) =>
      add({ severity: "error", code: "MULTIPLE_TRIGGERS", nodeId: t.id, message: `Only one trigger is allowed. Remove “${t.label}”.` }),
    );
  if (nodes.length === 1 && triggers.length === 1)
    add({ severity: "error", code: "NO_STEPS", message: "Add at least one step after the trigger." });

  // ---- edges
  const seenPairs = new Set<string>();
  for (const e of def.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      add({ severity: "error", code: "DANGLING_EDGE", message: "A connection points to a step that no longer exists." });
      continue;
    }
    if (!NODE_META[s.kind].outputs.includes(e.sourceHandle))
      add({ severity: "error", code: "BAD_HANDLE", nodeId: s.id, message: `“${s.label}” has no “${e.sourceHandle}” output.` });
    if (!NODE_META[t.kind].acceptsInput)
      add({ severity: "error", code: "INTO_TRIGGER", nodeId: t.id, message: `Nothing can connect into the trigger “${t.label}”.` });
    if (e.source === e.target) add({ severity: "error", code: "SELF_LOOP", nodeId: s.id, message: `“${s.label}” connects to itself.` });
    const pair = `${e.source}->${e.target}:${e.sourceHandle}`;
    if (seenPairs.has(pair)) add({ severity: "warning", code: "DUPLICATE_EDGE", nodeId: s.id, message: `“${s.label}” has a duplicate connection to “${t.label}”.` });
    seenPairs.add(pair);
    if (e.sourceHandle === "error" && t.kind !== "errorHandler")
      add({ severity: "warning", code: "ERROR_TARGET", nodeId: t.id, message: `The error path of “${s.label}” should lead to an error handler.` });
  }

  // ---- cycles (workflows must be a DAG; loops would need explicit iteration support)
  if (hasCycle(def)) add({ severity: "error", code: "CYCLE", message: "The workflow contains a loop. Remove the connection that leads back to an earlier step." });

  // ---- reachability
  const trigger = triggers[0];
  if (trigger) {
    const reachable = new Set<string>([trigger.id]);
    const queue = [trigger.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of def.edges) if (e.source === id && !reachable.has(e.target)) {
        reachable.add(e.target);
        queue.push(e.target);
      }
    }
    for (const n of nodes) {
      if (!reachable.has(n.id) && n.kind !== "trigger")
        add({ severity: "error", code: "UNREACHABLE", nodeId: n.id, message: `“${n.label}” isn't connected to the trigger, so it will never run.` });
    }
    if (!def.edges.some((e) => e.source === trigger.id) && nodes.length > 1)
      add({ severity: "error", code: "TRIGGER_UNCONNECTED", nodeId: trigger.id, message: "Connect the trigger to the first step." });
  }

  // ---- loops: the "For each item" path must be self-contained
  for (const loop of nodes.filter((n) => n.kind === "loop")) {
    const body = loopBody(def, loop.id);
    if (!def.edges.some((e) => e.source === loop.id && e.sourceHandle === "each"))
      add({ severity: "error", code: "LOOP_EMPTY", nodeId: loop.id, message: `Connect “${loop.label}”'s “For each item” path to the steps that should repeat.` });
    for (const id of body) {
      const outside = def.edges.find((e) => e.target === id && e.source !== loop.id && !body.has(e.source));
      if (outside) {
        const n = byId.get(id)!;
        add({ severity: "error", code: "LOOP_LEAK", nodeId: id, message: `“${n.label}” is inside the loop “${loop.label}” but is also reached from “${byId.get(outside.source)?.label}” outside it. Steps after the loop belong on its “Next” path.` });
      }
      if (def.edges.some((e) => e.source === loop.id && e.sourceHandle === "default" && e.target === id))
        add({ severity: "error", code: "LOOP_BOTH", nodeId: id, message: `“${byId.get(id)?.label}” can't be both inside and after the loop “${loop.label}”.` });
    }
  }

  // ---- per-node configuration
  for (const n of nodes) validateNode(n, def, ctx, add);

  return finish(issues);
}

/** Steps on a loop's "For each item" path: everything reachable from it, stopping at nothing (bodies are self-contained). */
export function loopBody(def: WorkflowDefinition, loopId: string): Set<string> {
  const body = new Set<string>();
  const queue = def.edges.filter((e) => e.source === loopId && e.sourceHandle === "each").map((e) => e.target);
  while (queue.length) {
    const id = queue.shift()!;
    if (body.has(id) || id === loopId) continue;
    body.add(id);
    for (const e of def.edges) if (e.source === id) queue.push(e.target);
  }
  return body;
}

function finish(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { valid: errors.length === 0, errors, warnings, issues, checkedAt: new Date().toISOString() };
}

function hasCycle(def: WorkflowDefinition): boolean {
  const adj = new Map<string, string[]>();
  for (const e of def.edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const next of adj.get(id) ?? []) if (visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  return def.nodes.some((n) => visit(n.id));
}

function validateNode(
  n: WorkflowNode,
  def: WorkflowDefinition,
  ctx: ValidationContext,
  add: (i: Omit<ValidationIssue, "id">) => void,
) {
  const req = (field: string, label: string) =>
    add({ severity: "error", code: "REQUIRED", nodeId: n.id, field, message: `${n.label}: ${label} is required.` });
  if (!n.label.trim()) req("label", "Step name");
  const outgoing = def.edges.filter((e) => e.source === n.id);

  switch (n.kind) {
    case "trigger": {
      if (n.config.triggerType === "webhook" && !n.config.eventName?.trim()) req("eventName", "Event name");
      if (n.config.triggerType === "schedule") {
        const sc = checkSchedule(n.config.schedule);
        if (sc.error) add({ severity: "error", code: "SCHEDULE", nodeId: n.id, field: "schedule", message: `${n.label}: ${sc.error}` });
        if (n.config.requiredFields.length)
          add({ severity: "warning", code: "SCHEDULE_FIELDS", nodeId: n.id, field: "requiredFields", message: `${n.label}: scheduled runs start with no input, so required fields will always be missing.` });
      }
      for (const f of n.config.requiredFields)
        if (!FIELD_PATH.test(f))
          add({ severity: "error", code: "FIELD_PATH", nodeId: n.id, field: "requiredFields", message: `${n.label}: “${f}” isn't a valid field path.` });
      break;
    }
    case "loop": {
      if (!n.config.field.trim()) req("field", "List field");
      else if (!FIELD_PATH.test(n.config.field)) add({ severity: "error", code: "FIELD_PATH", nodeId: n.id, field: "field", message: `${n.label}: “${n.config.field}” isn't a valid field path.` });
      if (!Number.isInteger(n.config.maxItems) || n.config.maxItems < 1 || n.config.maxItems > 500)
        add({ severity: "error", code: "RANGE", nodeId: n.id, field: "maxItems", message: `${n.label}: the item limit must be between 1 and 500.` });
      break;
    }
    case "formula": {
      const rows = n.config.assignments.filter((a) => a.target.trim() || a.expression.trim());
      if (!rows.length) add({ severity: "error", code: "REQUIRED", nodeId: n.id, field: "assignments", message: `${n.label}: add at least one field to calculate.` });
      rows.forEach((a, i) => {
        if (!FIELD_PATH.test(a.target)) add({ severity: "error", code: "FIELD_PATH", nodeId: n.id, field: `assignments.${i}.target`, message: `${n.label}: “${a.target || "(empty)"}” isn't a valid field name.` });
        try {
          checkFormula(a.expression);
        } catch (e) {
          add({ severity: "error", code: "FORMULA", nodeId: n.id, field: `assignments.${i}.expression`, message: `${n.label} › ${a.target || `row ${i + 1}`}: ${(e as Error).message}` });
        }
      });
      break;
    }
    case "http": {
      const c = n.config;
      if (!c.url.trim()) req("url", "URL");
      else {
        const check = checkOutboundUrl(c.url);
        if (!check.ok) add({ severity: "error", code: "UNSAFE_URL", nodeId: n.id, field: "url", message: `${n.label}: ${check.reason}` });
      }
      if (c.timeoutSec < 1 || c.timeoutSec > 120)
        add({ severity: "error", code: "RANGE", nodeId: n.id, field: "timeoutSec", message: `${n.label}: Timeout must be between 1 and 120 seconds.` });
      if (c.maxAttempts < 1 || c.maxAttempts > 10)
        add({ severity: "error", code: "RANGE", nodeId: n.id, field: "maxAttempts", message: `${n.label}: Attempts must be between 1 and 10.` });
      if (["POST", "PUT", "PATCH"].includes(c.method) && c.body?.trim()) {
        try {
          JSON.parse(c.body.replace(/\{\{[^}]+\}\}/g, "0"));
        } catch {
          add({ severity: "error", code: "JSON", nodeId: n.id, field: "body", message: `${n.label}: Request body must be valid JSON.` });
        }
      }
      for (const h of c.headers) {
        if (!h.key.trim())
          add({ severity: "error", code: "REQUIRED", nodeId: n.id, field: "headers", message: `${n.label}: Every header needs a name.` });
        if (/^authorization$/i.test(h.key))
          add({ severity: "error", code: "SECRET_IN_HEADER", nodeId: n.id, field: "headers", message: `${n.label}: Don't put credentials in headers. Select a connection instead.` });
      }
      if (c.method !== "GET" && !c.useIdempotencyKey)
        add({ severity: "warning", code: "NO_IDEMPOTENCY", nodeId: n.id, field: "useIdempotencyKey", message: `${n.label}: Retries could repeat this ${c.method} without an idempotency key.` });
      if (c.connectionId) checkConnection(n, c.connectionId, ctx, add);
      break;
    }
    case "action": {
      const c = n.config;
      if (!c.integrationId) req("integrationId", "Integration");
      else {
        const integ = ctx.integrations.find((i) => i.id === c.integrationId);
        if (!integ || integ.availability !== "available")
          add({ severity: "error", code: "INTEGRATION", nodeId: n.id, field: "integrationId", message: `${n.label}: This integration isn't available.` });
        else if (!c.actionKey) req("actionKey", "Action");
        else if (!integ.actions.some((a) => a.key === c.actionKey))
          add({ severity: "error", code: "ACTION", nodeId: n.id, field: "actionKey", message: `${n.label}: The selected action doesn't exist on ${integ.name}.` });
      }
      if (!c.connectionId) req("connectionId", "Connection");
      else checkConnection(n, c.connectionId, ctx, add);
      for (const m of c.inputMapping)
        if (!m.field.trim() || !m.source.trim())
          add({ severity: "error", code: "MAPPING", nodeId: n.id, field: "inputMapping", message: `${n.label}: Complete or remove empty input mappings.` });
      break;
    }
    case "condition": {
      const c = n.config;
      if (!c.field.trim()) req("field", "Field");
      else if (!FIELD_PATH.test(c.field))
        add({ severity: "error", code: "FIELD_PATH", nodeId: n.id, field: "field", message: `${n.label}: “${c.field}” isn't a valid field path.` });
      if (c.operator !== "exists" && !c.value.trim()) req("value", "Comparison value");
      if ((c.operator === "greater_than" || c.operator === "less_than") && c.value.trim() && Number.isNaN(Number(c.value)))
        add({ severity: "error", code: "NUMBER", nodeId: n.id, field: "value", message: `${n.label}: Use a number when comparing greater or less than.` });
      const hasTrue = outgoing.some((e) => e.sourceHandle === "true");
      const hasFalse = outgoing.some((e) => e.sourceHandle === "false");
      if (!hasTrue && !hasFalse)
        add({ severity: "error", code: "CONDITION_OUTPUTS", nodeId: n.id, message: `${n.label}: Connect at least one branch.` });
      else if (!hasTrue || !hasFalse)
        add({ severity: "warning", code: "CONDITION_BRANCH", nodeId: n.id, message: `${n.label}: The ${hasTrue ? "false" : "true"} branch ends the run.` });
      break;
    }
    case "delay": {
      const secs = n.config.amount * UNIT_SECONDS[n.config.unit];
      if (!Number.isFinite(n.config.amount) || n.config.amount <= 0)
        add({ severity: "error", code: "RANGE", nodeId: n.id, field: "amount", message: `${n.label}: Delay must be greater than zero.` });
      else if (secs > DELAY_LIMIT_SECONDS)
        add({ severity: "error", code: "RANGE", nodeId: n.id, field: "amount", message: `${n.label}: Delays are limited to 7 days.` });
      break;
    }
    case "transform": {
      const targets = new Set<string>();
      if (n.config.mappings.length === 0) req("mappings", "At least one mapping");
      n.config.mappings.forEach((m) => {
        if (!m.target.trim() || !m.source.trim())
          add({ severity: "error", code: "MAPPING", nodeId: n.id, field: "mappings", message: `${n.label}: Every mapping needs a source and a target.` });
        else if (!FIELD_PATH.test(m.target))
          add({ severity: "error", code: "FIELD_PATH", nodeId: n.id, field: "mappings", message: `${n.label}: “${m.target}” isn't a valid target field.` });
        if (m.target && targets.has(m.target))
          add({ severity: "error", code: "DUPLICATE_TARGET", nodeId: n.id, field: "mappings", message: `${n.label}: “${m.target}” is mapped twice.` });
        targets.add(m.target);
        if (m.fn === "default" && !m.fallback?.trim())
          add({ severity: "error", code: "REQUIRED", nodeId: n.id, field: "mappings", message: `${n.label}: Provide a fallback value for “${m.target || "mapping"}”.` });
      });
      break;
    }
    case "errorHandler": {
      const incomingError = def.edges.some((e) => e.target === n.id && e.sourceHandle === "error");
      if (!incomingError)
        add({ severity: "warning", code: "HANDLER_UNUSED", nodeId: n.id, message: `${n.label}: No step routes its error path here.` });
      if (n.config.catches.length === 0) req("catches", "At least one error type");
      if (n.config.strategy === "notify" && !n.config.notifyChannel?.trim()) req("notifyChannel", "Notification channel");
      break;
    }
  }
}

function checkConnection(
  n: WorkflowNode,
  connectionId: string,
  ctx: ValidationContext,
  add: (i: Omit<ValidationIssue, "id">) => void,
) {
  const conn = ctx.connections.find((c) => c.id === connectionId);
  if (!conn) add({ severity: "error", code: "CONNECTION", nodeId: n.id, field: "connectionId", message: `${n.label}: The selected connection no longer exists.` });
  else if (conn.status === "revoked")
    add({ severity: "error", code: "CONNECTION", nodeId: n.id, field: "connectionId", message: `${n.label}: “${conn.displayName}” has been revoked.` });
  else if (conn.status === "error")
    add({ severity: "warning", code: "CONNECTION", nodeId: n.id, field: "connectionId", message: `${n.label}: “${conn.displayName}” failed its last connection test.` });
}

/** Stable checksum for immutable versions (FNV-1a over canonical JSON). */
export function checksum(def: WorkflowDefinition): string {
  const canonical = JSON.stringify({
    nodes: [...def.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(({ position: _p, ...rest }) => rest),
    edges: [...def.edges].sort((a, b) => a.id.localeCompare(b.id)),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `sha-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
