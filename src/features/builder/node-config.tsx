"use client";

import { AlertCircle, AlertTriangle, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup, SwitchField } from "@/components/ui/checkbox";
import { Field, Fieldset } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import { CONNECTION_STATUS_META } from "@/lib/domain/status";
import { ERROR_STRATEGY_LABELS, HANDLE_LABELS, NODE_META, OPERATOR_LABELS, TRANSFORM_FN_LABELS } from "@/lib/domain/nodes";
import type { Connection, EdgeHandle, ErrorHandlerConfig, HttpMethod, NodeOf, TransformFn, WorkflowDefinition, WorkflowNode } from "@/lib/domain/types";
import { checkOutboundUrl } from "@/lib/domain/url-safety";
import type { ValidationIssue } from "@/lib/domain/validation";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import type { EditorAction } from "./state";
import { KindIcon } from "./node-card";
import { ScheduleEditor } from "./schedule-editor";
import { FORMULA_FUNCTIONS } from "@/lib/engine/formula";
import { defaultSchedule } from "@/lib/engine/schedule";
import { useCurrent } from "@/hooks/use-current";

interface Props {
  node: WorkflowNode;
  def: WorkflowDefinition;
  dispatch: React.Dispatch<EditorAction>;
  issues: ValidationIssue[];
  readOnly: boolean;
  connections: Connection[];
  webhooks: Array<{ id: string; name: string; workflowId: string }>;
  workflowId: string;
  onDelete: () => void;
  onClose?: () => void;
  headingId?: string;
}

/** BUILDER-02: per-kind configuration with inline validation. Every field is labelled and keyboard operable. */
export function NodeConfigPanel({ node, def, dispatch, issues, readOnly, connections, webhooks, workflowId, onDelete, onClose, headingId = "cfg-h" }: Props) {
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);
  const err = (field: string) => nodeIssues.find((i) => i.field === field && i.severity === "error")?.message.replace(`${node.label}: `, "") ?? null;
  const cfg = (config: Record<string, unknown>, key?: string) => dispatch({ type: "updateConfig", id: node.id, config, key: key ? `${node.id}:${key}` : undefined });
  const meta = NODE_META[node.kind];
  const general = nodeIssues.filter((i) => !i.field);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-3 border-b border-border p-4">
        <KindIcon kind={node.kind} />
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="truncate text-md font-semibold">{node.label || meta.label}</h2>
          <p className="text-sm text-fg-muted">{meta.description}</p>
        </div>
        {onClose && <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close configuration"><X aria-hidden /></Button>}
      </div>
      <div className="flex-1 overflow-y-auto">
        <fieldset disabled={readOnly} className="flex flex-col gap-4 p-4">
          {readOnly && <p className="rounded-md bg-surface-sunken p-2 text-sm text-fg-muted">Read-only. Published versions can't be edited; switch to the draft to make changes.</p>}
          {general.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Issues for this step">
              {general.map((i) => (
                <li key={i.id} className={`flex gap-2 rounded-md p-2 text-sm ${i.severity === "error" ? "bg-danger-soft text-danger-fg" : "bg-warning-soft text-warning-fg"}`}>
                  {i.severity === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
                  {i.message.replace(`${node.label}: `, "")}
                </li>
              ))}
            </ul>
          )}
          <Field label="Step name" required error={err("label")}>
            {(p) => <Input {...p} value={node.label} onChange={(e) => dispatch({ type: "updateNode", id: node.id, patch: { label: e.target.value }, key: `${node.id}:label` })} maxLength={60} />}
          </Field>
          <KindFields node={node} cfg={cfg} err={err} connections={connections} webhooks={webhooks} workflowId={workflowId} />
          <Outputs node={node} def={def} dispatch={dispatch} />
        </fieldset>
      </div>
      {!readOnly && (
        <div className="border-t border-border p-3">
          <Button variant="destructive-outline" size="sm" onClick={onDelete}><Trash2 aria-hidden /> Delete step</Button>
        </div>
      )}
    </div>
  );
}

function Outputs({ node, def, dispatch }: { node: WorkflowNode; def: WorkflowDefinition; dispatch: React.Dispatch<EditorAction> }) {
  const outputs = NODE_META[node.kind].outputs;
  const incoming = def.edges.filter((e) => e.target === node.id).map((e) => ({ e, from: def.nodes.find((n) => n.id === e.source) }));
  const targets = def.nodes.filter((n) => n.id !== node.id && NODE_META[n.kind].acceptsInput);
  return (
    <Fieldset legend="Connections" description="Keyboard alternative to dragging between handles on the canvas. An output can lead to several steps; they all run, one branch after another." className="border-t border-border pt-4">
      {outputs.map((h: EdgeHandle) => {
        const current = def.edges.find((e) => e.source === node.id && e.sourceHandle === h);
        if (h !== "error") {
          const chosen = def.edges.filter((e) => e.source === node.id && e.sourceHandle === h).map((e) => e.target);
          return (
            <Field key={h} label={`${HANDLE_LABELS[h]} goes to`} description={chosen.length > 1 ? "These branches all run, in this order." : undefined}>
              {(p) => (
                <MultiSelect {...p} value={chosen} placeholder="Nothing (ends here)" onValueChange={(v) => dispatch({ type: "setOutputs", source: node.id, handle: h, targets: v })}
                  options={targets.map((t) => ({ value: t.id, label: t.label, description: NODE_META[t.kind].label }))} />
              )}
            </Field>
          );
        }
        return (
          <Field key={h} label={`${HANDLE_LABELS[h]} goes to`}>
            {(p) => (
              <Select {...p} value={current?.target ?? "__none"} onValueChange={(v) => dispatch({ type: "setOutput", source: node.id, handle: h, target: v === "__none" ? null : v })}
                options={[{ value: "__none", label: h === "error" ? "Not handled (run fails)" : "Nothing (ends here)" }, ...targets.map((t) => ({ value: t.id, label: t.label, description: NODE_META[t.kind].label }))]} />
            )}
          </Field>
        );
      })}
      {node.kind !== "trigger" && (
        <p className="text-sm text-fg-muted">
          {incoming.length ? <>Runs after {incoming.map((i, idx) => <React.Fragment key={i.e.id}>{idx > 0 && ", "}<strong>{i.from?.label}</strong>{i.e.sourceHandle !== "default" && ` (${HANDLE_LABELS[i.e.sourceHandle].toLowerCase()})`}</React.Fragment>)}.</> : "Nothing connects into this step yet."}
        </p>
      )}
    </Fieldset>
  );
}

function NumberInput({ value, onChange, min, max, ...p }: { value: number; onChange: (n: number) => void; min: number; max: number } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return <Input {...p} type="number" inputMode="numeric" min={min} max={max} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))} />;
}

type Cfg = (config: Record<string, unknown>, key?: string) => void;

function KindFields({ node, cfg, err, connections, webhooks, workflowId }: { node: WorkflowNode; cfg: Cfg; err: (f: string) => string | null; connections: Connection[]; webhooks: Props["webhooks"]; workflowId: string }) {
  const { workspace } = useCurrent();
  switch (node.kind) {
    case "trigger": {
      const c = node.config;
      const own = webhooks.filter((w) => w.workflowId === workflowId);
      return (
        <>
          <Fieldset legend="Starts when">
            <RadioGroup value={c.triggerType} onValueChange={(v) => cfg(v === "schedule" && !c.schedule ? { triggerType: v, schedule: defaultSchedule(workspace?.settings.timezone || "UTC") } : { triggerType: v })}>
              <RadioCard id={`${node.id}-t-webhook`} value="webhook" label="A signed webhook is received" description="HMAC-SHA256 signature, timestamp and replay window are verified." />
              <RadioCard id={`${node.id}-t-manual`} value="manual" label="Someone runs it manually" description="From Brightrail or POST /workflows/:id/runs." />
              <RadioCard id={`${node.id}-t-schedule`} value="schedule" label="On a schedule" description="Every few minutes, daily, weekly, monthly or a cron expression." />
            </RadioGroup>
          </Fieldset>
          {c.triggerType === "schedule" && (
            <ScheduleEditor id={node.id} value={c.schedule} error={err("schedule")} workspaceTimezone={workspace?.settings.timezone || "UTC"} onChange={(schedule, key) => cfg({ schedule }, key ? `sched-${key}` : undefined)} />
          )}
          {c.triggerType === "webhook" && (
            <>
              <Field label="Event name" required error={err("eventName")} description="Used to label runs, for example order.created.">
                {(p) => <Input {...p} value={c.eventName ?? ""} onChange={(e) => cfg({ eventName: e.target.value }, "event")} className="font-mono" />}
              </Field>
              <Field label="Webhook endpoint" description={own.length ? undefined : "No endpoint yet. Create one under Webhooks after publishing."}>
                {(p) => <Select {...p} value={c.webhookEndpointId ?? "__none"} onValueChange={(v) => cfg({ webhookEndpointId: v === "__none" ? undefined : v })} options={[{ value: "__none", label: "Not linked yet" }, ...own.map((w) => ({ value: w.id, label: w.name }))]} />}
              </Field>
            </>
          )}
          <Field label="Required payload fields" optional error={err("requiredFields")} description="Comma-separated field paths. Runs missing these fail validation before any external call.">
            {(p) => <Input {...p} value={c.requiredFields.join(", ")} onChange={(e) => cfg({ requiredFields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }, "req")} className="font-mono" placeholder="orderId, customerEmail" />}
          </Field>
        </>
      );
    }
    case "http": {
      const c = node.config;
      const urlCheck = c.url ? checkOutboundUrl(c.url) : null;
      const httpConns = connections.filter((x) => x.integrationId === "int_http");
      return (
        <>
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <Field label="Method">{(p) => <Select<HttpMethod> {...p} value={c.method} onValueChange={(v) => cfg({ method: v })} options={(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((m) => ({ value: m, label: m }))} />}</Field>
            <Field label="URL" required error={err("url") ?? (urlCheck && !urlCheck.ok ? urlCheck.reason : null)}>
              {(p) => <Input {...p} value={c.url} onChange={(e) => cfg({ url: e.target.value }, "url")} className="font-mono text-sm" placeholder="https://api.example.com/orders/{{orderId}}" inputMode="url" />}
            </Field>
          </div>
          <Field label="Connection" optional description="Credentials are injected by the worker. Never paste tokens into headers." error={err("connectionId")}>
            {(p) => <Select {...p} value={c.connectionId ?? "__none"} onValueChange={(v) => cfg({ connectionId: v === "__none" ? undefined : v })} emptyMessage="No HTTP connections"
              options={[{ value: "__none", label: "No authentication" }, ...httpConns.map((x) => ({ value: x.id, label: x.displayName, description: CONNECTION_STATUS_META[x.status].label, disabled: x.status === "revoked" }))]} />}
          </Field>
          <KeyValueRows label="Headers" rows={c.headers} error={err("headers")} onChange={(headers) => cfg({ headers }, "headers")} keyLabel="Header" valueLabel="Value" />
          {c.method !== "GET" && c.method !== "DELETE" && (
            <Field label="JSON body" optional error={err("body")} description="Use {{field}} to insert run data.">
              {(p) => <Textarea {...p} value={c.body ?? ""} onChange={(e) => cfg({ body: e.target.value }, "body")} rows={5} className="font-mono text-sm" spellCheck={false} />}
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timeout (s)" error={err("timeoutSec")}>{(p) => <NumberInput {...p} min={1} max={120} value={c.timeoutSec} onChange={(n) => cfg({ timeoutSec: n }, "timeout")} />}</Field>
            <Field label="Max attempts" error={err("maxAttempts")}>{(p) => <NumberInput {...p} min={1} max={10} value={c.maxAttempts} onChange={(n) => cfg({ maxAttempts: n }, "attempts")} />}</Field>
          </div>
          <SwitchField id={`${node.id}-idem`} label="Send idempotency key" description="Retries reuse the same key so the destination can deduplicate." checked={c.useIdempotencyKey} onCheckedChange={(v) => cfg({ useIdempotencyKey: v })} />
        </>
      );
    }
    case "action": {
      const c = node.config;
      const integrations = INTEGRATIONS.filter((i) => i.availability === "available" && i.actions.length > 0);
      const integ = integrations.find((i) => i.id === c.integrationId);
      const action = integ?.actions.find((a) => a.key === c.actionKey);
      const conns = connections.filter((x) => x.integrationId === c.integrationId);
      return (
        <>
          <Field label="Integration" required error={err("integrationId")}>
            {(p) => <Select {...p} value={c.integrationId} onValueChange={(v) => cfg({ integrationId: v, actionKey: undefined, connectionId: undefined })} placeholder="Choose an integration" options={integrations.map((i) => ({ value: i.id, label: i.name, description: i.category }))} />}
          </Field>
          <Field label="Action" required error={err("actionKey")}>
            {(p) => <Select {...p} value={c.actionKey} onValueChange={(v) => cfg({ actionKey: v })} disabled={!integ} placeholder={integ ? "Choose an action" : "Choose an integration first"} options={(integ?.actions ?? []).map((a) => ({ value: a.key, label: a.name, description: a.description }))} />}
          </Field>
          {action && (
            <div className="flex flex-wrap gap-1.5" aria-label="Connector contract">
              <Badge tone={action.idempotent ? "success" : "warning"}>{action.idempotent ? "Idempotent" : "Not idempotent"}</Badge>
              <Badge tone="neutral">{action.retryable ? "Retryable" : "Not retryable"}</Badge>
              <Badge tone="neutral">Scopes: {action.scopes.join(", ")}</Badge>
            </div>
          )}
          <Field label="Connection" required error={err("connectionId")} description={integ && conns.length === 0 ? undefined : "Which stored credential the worker uses."}>
            {(p) => <Select {...p} value={c.connectionId} onValueChange={(v) => cfg({ connectionId: v })} disabled={!integ} placeholder="Choose a connection" emptyMessage="No connections for this integration"
              options={conns.map((x) => ({ value: x.id, label: x.displayName, description: CONNECTION_STATUS_META[x.status].label, disabled: x.status === "revoked" }))} />}
          </Field>
          {integ && conns.length === 0 && <p className="text-sm text-fg-muted">No connections yet. <Link className="text-link underline" href={`/integrations/${integ.id}/connect`}>Connect {integ.name}</Link>.</p>}
          <p className="text-sm text-fg-muted">Fill each input with a field from the run (for example <code className="font-mono">email</code>) or with text that includes fields, like <code className="font-mono">{"Hi {{name}}"}</code>.{action ? ` Inputs used: ${action.key === "email.send" ? "to, subject, text" : "text"}.` : ""}</p>
          <KeyValueRows label="Input mapping" rows={c.inputMapping.map((m) => ({ key: m.field, value: m.source }))} error={err("inputMapping")} onChange={(rows) => cfg({ inputMapping: rows.map((r) => ({ field: r.key, source: r.value })) }, "map")} keyLabel="Field" valueLabel="From run data" mono />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timeout (s)">{(p) => <NumberInput {...p} min={1} max={120} value={c.timeoutSec} onChange={(n) => cfg({ timeoutSec: n }, "timeout")} />}</Field>
            <Field label="Max attempts">{(p) => <NumberInput {...p} min={1} max={10} value={c.maxAttempts} onChange={(n) => cfg({ maxAttempts: n }, "attempts")} />}</Field>
          </div>
        </>
      );
    }
    case "condition": {
      const c = node.config;
      return (
        <>
          <Field label="Field" required error={err("field")} description="Path in the run data, for example payments.status">
            {(p) => <Input {...p} value={c.field} onChange={(e) => cfg({ field: e.target.value }, "field")} className="font-mono" />}
          </Field>
          <Field label="Operator">
            {(p) => <Select {...p} value={c.operator} onValueChange={(v) => cfg({ operator: v })} options={(Object.keys(OPERATOR_LABELS) as Array<keyof typeof OPERATOR_LABELS>).map((k) => ({ value: k, label: OPERATOR_LABELS[k] }))} />}
          </Field>
          {c.operator !== "exists" && (
            <Field label="Value" required error={err("value")}>{(p) => <Input {...p} value={c.value} onChange={(e) => cfg({ value: e.target.value }, "value")} />}</Field>
          )}
        </>
      );
    }
    case "delay": {
      const c = node.config;
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Wait for" required error={err("amount")}>{(p) => <NumberInput {...p} min={1} max={10000} value={c.amount} onChange={(n) => cfg({ amount: n }, "amount")} />}</Field>
          <Field label="Unit">{(p) => <Select {...p} value={c.unit} onValueChange={(v) => cfg({ unit: v })} options={(["seconds", "minutes", "hours", "days"] as const).map((u) => ({ value: u, label: u[0]!.toUpperCase() + u.slice(1) }))} />}</Field>
          <p className="col-span-2 text-sm text-fg-muted">Durable timer: the run survives worker restarts while waiting. Maximum 7 days.</p>
        </div>
      );
    }
    case "transform":
      return <TransformRows node={node} cfg={cfg} error={err("mappings")} />;
    case "loop": {
      const c = node.config;
      return (
        <>
          <Field label="List to go through" required error={err("field")} description="The field that holds a list, e.g. items, order.lines or body.results.">
            {(p) => <Input {...p} value={c.field} onChange={(e) => cfg({ field: e.target.value.trim() }, "field")} className="font-mono" placeholder="items" />}
          </Field>
          <Field label="Most items to process" error={err("maxItems")} description="A safety limit (1–500). Extra items are skipped and noted in the run log.">
            {(p) => <NumberInput {...p} min={1} max={500} value={c.maxItems} onChange={(n) => cfg({ maxItems: n }, "max")} className="w-32" />}
          </Field>
          <div className="rounded-md border border-border bg-surface-sunken p-3 text-sm text-fg-muted">
            <p>Connect the <strong>For each item</strong> output to the steps that should repeat, and <strong>Next</strong> to what happens after the whole list is done.</p>
            <p className="mt-2">Inside the loop, use <code>{"{{item}}"}</code> (or <code>{"{{item.email}}"}</code>), <code>{"{{index}}"}</code> (0, 1, 2…) and <code>{"{{loop.number}}"}</code> / <code>{"{{loop.count}}"}</code>. Items run one at a time; each gets its own retries.</p>
          </div>
        </>
      );
    }
    case "formula":
      return <FormulaRows node={node} cfg={cfg} err={err} />;
    case "errorHandler": {
      const c = node.config;
      return (
        <>
          <Field label="When an error is routed here">
            {(p) => <Select {...p} value={c.strategy} onValueChange={(v) => cfg({ strategy: v })} options={(Object.keys(ERROR_STRATEGY_LABELS) as Array<ErrorHandlerConfig["strategy"]>).map((k) => ({ value: k, label: ERROR_STRATEGY_LABELS[k] }))} />}
          </Field>
          <Field label="Catches" required error={err("catches")}>
            {(p) => <MultiSelect {...p} value={c.catches} onValueChange={(v) => cfg({ catches: v })} searchable={false}
              options={[{ value: "timeout", label: "Timeouts" }, { value: "http_5xx", label: "Server errors (5xx)" }, { value: "http_4xx", label: "Client errors (4xx)" }, { value: "validation", label: "Validation errors" }, { value: "any", label: "Any error" }]} />}
          </Field>
          {c.strategy === "notify" && (
            <Field label="Notification channel" required error={err("notifyChannel")}>{(p) => <Input {...p} value={c.notifyChannel ?? ""} onChange={(e) => cfg({ notifyChannel: e.target.value }, "chan")} placeholder="#ops-alerts" />}</Field>
          )}
        </>
      );
    }
  }
}

function KeyValueRows({ label, rows, onChange, error, keyLabel, valueLabel, mono }: { label: string; rows: Array<{ key: string; value: string }>; onChange: (r: Array<{ key: string; value: string }>) => void; error: string | null; keyLabel: string; valueLabel: string; mono?: boolean }) {
  const id = React.useId();
  return (
    <Fieldset legend={label} error={error}>
      {rows.length === 0 && <p className="text-sm text-fg-muted">None.</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input aria-label={`${keyLabel} ${i + 1}`} value={r.key} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} placeholder={keyLabel} className={mono ? "font-mono text-sm" : undefined} />
          <Input aria-label={`${valueLabel} ${i + 1}`} value={r.value} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={valueLabel} className="font-mono text-sm" />
          <Button variant="ghost" size="icon-sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${label.toLowerCase()} row ${i + 1}`}><Trash2 aria-hidden /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-fit" onClick={() => onChange([...rows, { key: "", value: "" }])} aria-describedby={id}><Plus aria-hidden /> Add row</Button>
      <span id={id} className="sr-only">Adds an empty {label.toLowerCase()} row</span>
    </Fieldset>
  );
}

function TransformRows({ node, cfg, error }: { node: NodeOf<"transform">; cfg: Cfg; error: string | null }) {
  const rows = node.config.mappings;
  const set = (mappings: typeof rows) => cfg({ mappings }, "mappings");
  return (
    <Fieldset legend="Field mappings" description="Only these safe functions are available. Custom code isn't supported." error={error}>
      {rows.map((m, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-2">
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label={`Source field ${i + 1}`} placeholder="Source path" value={m.source} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))} className="font-mono text-sm" />
            <Input aria-label={`Target field ${i + 1}`} placeholder="Target path" value={m.target} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} className="font-mono text-sm" />
          </div>
          <div className="flex gap-2">
            <Select<TransformFn> aria-label={`Function ${i + 1}`} value={m.fn} onValueChange={(v) => set(rows.map((x, j) => (j === i ? { ...x, fn: v } : x)))} options={(Object.keys(TRANSFORM_FN_LABELS) as TransformFn[]).map((k) => ({ value: k, label: TRANSFORM_FN_LABELS[k] }))} />
            {m.fn === "default" && <Input aria-label={`Fallback value ${i + 1}`} placeholder="Fallback" value={m.fallback ?? ""} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, fallback: e.target.value } : x)))} />}
            <Button variant="ghost" size="icon" onClick={() => set(rows.filter((_, j) => j !== i))} aria-label={`Remove mapping ${i + 1}`}><Trash2 aria-hidden /></Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-fit" onClick={() => set([...rows, { source: "", target: "", fn: "copy" }])}><Plus aria-hidden /> Add mapping</Button>
    </Fieldset>
  );
}

/** Formula step: one row per field, each `target = expression`, evaluated top to bottom. */
function FormulaRows({ node, cfg, err }: { node: NodeOf<"formula">; cfg: Cfg; err: (f: string) => string | null }) {
  const rows = node.config.assignments;
  const set = (next: typeof rows) => cfg({ assignments: next }, "formula");
  const [showHelp, setShowHelp] = React.useState(false);
  return (
    <Fieldset legend="Calculate" description="Each row sets a field. Later rows can use fields set above them. Read fields by name, like amount or order.items[0].price.">
      <div className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
            <div className="flex items-end gap-2">
              <Field label="Field" className="w-40 shrink-0" error={err(`assignments.${i}.target`)}>
                {(p) => <Input {...p} value={r.target} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, target: e.target.value.trim() } : x)))} className="font-mono" placeholder="total" />}
              </Field>
              <span className="pb-2 font-mono text-fg-muted" aria-hidden>=</span>
              <Field label="Formula" className="min-w-0 flex-1" error={err(`assignments.${i}.expression`)}>
                {(p) => <Input {...p} value={r.expression} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, expression: e.target.value } : x)))} className="font-mono" placeholder="round(amount * 1.08, 2)" spellCheck={false} />}
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove row ${i + 1}`} disabled={rows.length === 1} onClick={() => set(rows.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set([...rows, { target: "", expression: "" }])}><Plus aria-hidden /> Add field</Button>
        <div className="text-sm text-fg-muted">
          <p>Operators: <code>+ - * / %</code>, <code>== != &lt; &lt;= &gt; &gt;=</code>, <code>&amp;&amp; || !</code>. Text in quotes: <code>&quot;hello&quot;</code>. Examples: <code>if(amount &gt; 100, &quot;large&quot;, &quot;small&quot;)</code>, <code>concat(first_name, &quot; &quot;, last_name)</code>, <code>formatDate(addDays(now(), 7), &quot;YYYY-MM-DD&quot;)</code>.</p>
          <button type="button" className="mt-1 text-link underline" aria-expanded={showHelp} onClick={() => setShowHelp(!showHelp)}>{showHelp ? "Hide" : "Show"} all functions</button>
          {showHelp && (
            <ul className="mt-2 grid gap-x-4 gap-y-0.5 font-mono text-xs sm:grid-cols-2">
              {FORMULA_FUNCTIONS.map((f) => <li key={f.name}>{f.help}</li>)}
            </ul>
          )}
        </div>
      </div>
    </Fieldset>
  );
}
