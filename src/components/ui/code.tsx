"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";
import type { JsonValue, LogEntry } from "@/lib/domain/types";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Badge } from "./badge";

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span>{copied ? "Copied" : label}</span>
      <span className="sr-only" aria-live="polite">{copied ? "Copied to clipboard" : ""}</span>
    </Button>
  );
}

function render(value: JsonValue, indent = 0): React.ReactNode {
  const pad = "  ".repeat(indent);
  if (value === null) return <span className="text-fg-subtle">null</span>;
  if (typeof value === "string")
    return <span className={value === "[REDACTED]" ? "rounded-xs bg-warning-soft px-1 text-warning-fg" : "text-success-fg dark:text-success"}>{value === "[REDACTED]" ? value : JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="text-info-fg dark:text-info">{value}</span>;
  if (typeof value === "boolean") return <span className="text-primary">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return (
      <>
        {"[\n"}
        {value.map((v, i) => (
          <React.Fragment key={i}>
            {pad}  {render(v, indent + 1)}
            {i < value.length - 1 ? ",\n" : "\n"}
          </React.Fragment>
        ))}
        {pad}]
      </>
    );
  }
  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  return (
    <>
      {"{\n"}
      {entries.map(([k, v], i) => (
        <React.Fragment key={k}>
          {pad}  <span className="text-secondary">{JSON.stringify(k)}</span>: {render(v, indent + 1)}
          {i < entries.length - 1 ? ",\n" : "\n"}
        </React.Fragment>
      ))}
      {pad}
      {"}"}
    </>
  );
}

/** Read-only JSON inspector. Redacted values are highlighted and labelled. */
export function JsonViewer({ value, label, className, maxHeight = "max-h-80" }: { value: JsonValue | undefined; label: string; className?: string; maxHeight?: string }) {
  if (value === undefined) return <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-fg-muted">No {label.toLowerCase()} recorded for this step.</p>;
  const text = JSON.stringify(value, null, 2);
  const redacted = text.includes("[REDACTED]") || text.includes("•••");
  return (
    <div className={cn("overflow-hidden rounded-md border border-border", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-sunken px-3 py-1">
        <span className="flex items-center gap-2 text-sm font-medium text-fg-muted">
          {label}
          {redacted && <Badge tone="warning">Sensitive fields redacted</Badge>}
        </span>
        <CopyButton value={text} label="Copy JSON" />
      </div>
      <pre tabIndex={0} aria-label={`${label} JSON`} className={cn("overflow-auto bg-surface p-3 font-mono text-[12.5px] leading-5 whitespace-pre text-fg", maxHeight)}>
        {render(value)}
      </pre>
    </div>
  );
}

export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-border", className)}>
      {label && (
        <div className="flex items-center justify-between border-b border-border bg-surface-sunken px-3 py-1">
          <span className="text-sm font-medium text-fg-muted">{label}</span>
          <CopyButton value={code} />
        </div>
      )}
      <pre tabIndex={0} className="overflow-auto bg-surface p-3 font-mono text-[12.5px] leading-5 text-fg">{code}</pre>
    </div>
  );
}

const LEVEL_TONE = { debug: "neutral", info: "info", warn: "warning", error: "danger" } as const;

/** Structured log viewer with level filtering handled by the caller. */
export function LogViewer({ logs, stepLabel, className, emptyText = "No log lines match these filters." }: { logs: LogEntry[]; stepLabel?: (id?: string) => string | undefined; className?: string; emptyText?: string }) {
  if (!logs.length) return <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-fg-muted">{emptyText}</p>;
  return (
    <ol className={cn("divide-y divide-border overflow-hidden rounded-md border border-border bg-surface font-mono text-[12.5px]", className)} aria-label="Log lines">
      {logs.map((l) => (
        <li key={l.id} className={cn("flex flex-col gap-1 px-3 py-2 sm:flex-row sm:gap-3", l.level === "error" && "bg-danger-soft/50")}>
          <div className="flex shrink-0 items-center gap-2 sm:w-44">
            <time dateTime={l.ts} className="text-fg-subtle tabular">{formatTime(l.ts)}.{new Date(l.ts).getMilliseconds().toString().padStart(3, "0")}</time>
            <Badge tone={LEVEL_TONE[l.level]} className="h-5 px-1 font-mono text-[11px] uppercase">{l.level}</Badge>
          </div>
          <div className="min-w-0 flex-1">
            {stepLabel?.(l.stepId) && <span className="mr-2 text-fg-muted">[{stepLabel(l.stepId)}]</span>}
            <span className="break-words whitespace-pre-wrap text-fg">{l.message}</span>
            {l.fields && Object.keys(l.fields).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-fg-subtle">
                {Object.entries(l.fields).map(([k, v]) => (
                  <span key={k} className="break-all">{k}=<span className="text-fg-muted">{String(v)}</span></span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
