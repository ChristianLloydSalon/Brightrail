import { CalendarClock, Check, CodeXml, GitBranch, Globe, KeyRound, Play, ScanSearch, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusChip } from "./run-rail";

/**
 * Small, faithful slices of the product UI shown beside each stop of "How it works".
 * They are illustrations: the surrounding copy carries the meaning, so they are hidden from assistive tech.
 */
function Frame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div aria-hidden className={cn("overflow-hidden rounded-lg border border-border bg-surface shadow-md", className)}>
      <div className="flex items-center justify-between border-b border-border bg-surface-sunken px-4 py-2.5">
        <span className="font-mono text-xs text-fg-subtle">{title}</span>
        <span className="flex gap-1.5">
          <span className="size-2 rounded-full bg-border-strong" />
          <span className="size-2 rounded-full bg-border-strong" />
        </span>
      </div>
      {children}
    </div>
  );
}

function Node({ kind, name, icon: Icon, tone = "primary" }: { kind: string; name: string; icon: React.ComponentType<{ className?: string }>; tone?: "primary" | "info" }) {
  return (
    <div className="flex w-full max-w-[260px] items-center gap-3 rounded-lg border border-border-strong bg-surface px-3 py-2.5 shadow-sm">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", tone === "primary" ? "bg-primary-soft text-primary-soft-fg" : "bg-info-soft text-info-fg")}>
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-fg-subtle">{kind}</span>
        <span className="truncate font-mono text-sm text-fg">{name}</span>
      </span>
    </div>
  );
}

function Wire({ label }: { label?: string }) {
  return (
    <span className="relative flex h-8 w-full max-w-[260px] justify-center">
      <span className="h-full w-0.5 bg-border-strong" />
      {label && <span className="absolute top-1.5 left-[calc(50%+10px)] font-mono text-xs text-fg-subtle">{label}</span>}
    </span>
  );
}

export function BuildFragment() {
  return (
    <Frame title="invoice-on-order · draft">
      <div className="flex flex-col items-center bg-[radial-gradient(var(--canvas-dot)_1px,transparent_1px)] bg-[size:20px_20px] px-5 py-6" style={{ backgroundColor: "var(--canvas-bg)" }}>
        <Node kind="Trigger" name="order.created" icon={Webhook} />
        <Wire />
        <Node kind="Condition" name="{{amount}} > 0" icon={GitBranch} tone="info" />
        <Wire label="true" />
        <Node kind="HTTP request" name="POST /invoices" icon={Globe} />
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-sm text-success-fg">
        <Check className="size-4" /> Ready to publish · 0 problems
      </div>
    </Frame>
  );
}

const TRIGGERS = [
  { icon: Play, name: "Manual", value: "Run now" },
  { icon: CodeXml, name: "REST API", value: "POST /api/v1/workflows/:id/runs" },
  { icon: Webhook, name: "Signed webhook", value: "X-Brightrail-Signature: sha256=…" },
  { icon: CalendarClock, name: "Schedule", value: "0 9 * * 1-5 · Asia/Manila" },
];

export function TriggerFragment() {
  return (
    <Frame title="Triggers">
      <ul className="divide-y divide-border">
        {TRIGGERS.map((t) => (
          <li key={t.name} className="flex items-center gap-3 px-4 py-3">
            <t.icon className="size-4 shrink-0 text-secondary" />
            <span className="w-28 shrink-0 text-sm font-medium text-fg">{t.name}</span>
            <span className="min-w-0 truncate font-mono text-xs text-fg-muted">{t.value}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

const ATTEMPTS = [
  { n: 1, what: "timeout after 30 s", wait: "backoff 2 s", tone: "warning" as const, status: "retrying" },
  { n: 2, what: "timeout after 30 s", wait: "backoff 4 s", tone: "warning" as const, status: "retrying" },
  { n: 3, what: "201 Created · 640 ms", wait: "", tone: "success" as const, status: "succeeded" },
];

export function RunFragment() {
  return (
    <Frame title="run_5d07c4 · Generate invoice · attempts">
      <ul className="divide-y divide-border">
        {ATTEMPTS.map((a) => (
          <li key={a.n} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <span className="tabular font-mono text-sm text-fg-subtle">#{a.n}</span>
            <span className="font-mono text-sm text-fg">{a.what}</span>
            {a.wait && <span className="font-mono text-xs text-fg-subtle">{a.wait}</span>}
            <StatusChip tone={a.tone} className="ml-auto">{a.status}</StatusChip>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-border bg-surface-sunken px-4 py-2.5 font-mono text-xs text-fg-muted">
        <KeyRound className="size-3.5 shrink-0" /> idempotency key ff_9c41e0a7d23b5f18 · same on every attempt
      </div>
    </Frame>
  );
}

export function InspectFragment() {
  return (
    <Frame title="run_8f3a21 · Generate invoice · input">
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-6 text-fg-muted">
        <span className="text-fg-subtle">{"{"}</span>
        {"\n  "}<span className="text-fg">&quot;order&quot;</span>: &quot;ord_2291&quot;,
        {"\n  "}<span className="text-fg">&quot;amount&quot;</span>: 4800,
        {"\n  "}<span className="text-fg">&quot;email&quot;</span>: <span className="rounded-xs bg-warning-soft px-1 text-warning-fg">&quot;j•••@•••.com&quot;</span>,
        {"\n  "}<span className="text-fg">&quot;api_key&quot;</span>: <span className="rounded-xs bg-danger-soft px-1 text-danger-fg">&quot;[REDACTED]&quot;</span>
        {"\n"}<span className="text-fg-subtle">{"}"}</span>
      </pre>
      <div className="border-t border-border px-4 py-2.5 font-mono text-xs text-fg-muted">
        <span className="text-info-fg">info</span> 02:14:37 step.retry <span className="text-fg-subtle">corr=8f3a21</span>
      </div>
    </Frame>
  );
}

export function RecoverFragment() {
  return (
    <Frame title="Failed run · AI analysis">
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center gap-2">
          <ScanSearch className="size-4 text-info" />
          <span className="text-sm font-semibold text-fg">Transient provider timeout</span>
          <StatusChip tone="info" className="ml-auto">high confidence</StatusChip>
        </div>
        <p className="text-sm text-fg-muted">The invoice API stopped responding. Earlier steps succeeded, so retrying only this step is safe.</p>
        <div className="rounded-md border border-primary-border bg-primary-soft p-3">
          <p className="text-sm font-medium text-primary-soft-fg">Recommended: retry “Generate invoice”</p>
          <p className="mt-0.5 text-xs text-primary-soft-fg">Needs approval from an Operator or Admin · expires in 24 h</p>
          <div className="mt-3 flex gap-2">
            <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg">Approve</span>
            <span className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg">Reject</span>
          </div>
        </div>
      </div>
    </Frame>
  );
}
