"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertCircle, AlertTriangle, Calculator, Clock, GitBranch, Globe, Plug, Repeat, ShieldAlert, Shuffle, Zap } from "lucide-react";
import * as React from "react";
import { HANDLE_LABELS, NODE_META, summarizeNode } from "@/lib/domain/nodes";
import type { NodeKind, WorkflowNode } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<NodeKind, React.ComponentType<{ className?: string }>> = {
  trigger: Zap, http: Globe, action: Plug, condition: GitBranch, loop: Repeat, formula: Calculator, delay: Clock, transform: Shuffle, errorHandler: ShieldAlert,
};
/** Accent per kind. Always paired with the icon and the kind label, never used alone. */
export const KIND_ACCENT: Record<NodeKind, string> = {
  trigger: "var(--primary)", http: "var(--info)", action: "var(--secondary)", condition: "var(--warning)", loop: "var(--warning)", formula: "var(--success)", delay: "var(--text-subtle)", transform: "var(--success)", errorHandler: "var(--danger)",
};

export interface FlowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  errors: number;
  warnings: number;
  readOnly: boolean;
}

export function KindIcon({ kind, className }: { kind: NodeKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", className)} style={{ background: `color-mix(in oklab, ${KIND_ACCENT[kind]} 14%, transparent)`, color: KIND_ACCENT[kind] }} aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}

export const FlowNodeCard = React.memo(function FlowNodeCard({ data, selected }: NodeProps & { data: FlowNodeData }) {
  const { node, errors, warnings, readOnly } = data;
  const meta = NODE_META[node.kind];
  const outputs = meta.outputs;
  return (
    <div
      className={cn(
        "br-node relative w-60 rounded-lg border bg-surface text-left shadow-sm transition-shadow",
        selected ? "border-primary shadow-md ring-2 ring-primary/25" : "border-border-strong",
        errors > 0 && !selected && "border-danger",
      )}
    >
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: KIND_ACCENT[node.kind] }} aria-hidden />
      {meta.acceptsInput && <Handle type="target" position={Position.Left} isConnectable={!readOnly} />}
      <div className="flex items-start gap-2.5 p-3 pl-4">
        <KindIcon kind={node.kind} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-medium tracking-wide text-fg-subtle uppercase">{meta.label}</span>
          <span className="truncate text-base font-semibold text-fg">{node.label}</span>
          <span className="truncate text-sm text-fg-muted">{summarizeNode(node)}</span>
        </div>
        {errors > 0 ? (
          <span className="flex items-center gap-0.5 text-xs font-semibold text-danger" title={`${errors} error${errors === 1 ? "" : "s"}`}><AlertCircle className="size-4" aria-hidden />{errors}</span>
        ) : warnings > 0 ? (
          <span className="flex items-center gap-0.5 text-xs font-semibold text-warning" title={`${warnings} warning${warnings === 1 ? "" : "s"}`}><AlertTriangle className="size-4" aria-hidden />{warnings}</span>
        ) : null}
      </div>
      {outputs.length > 1 && (
        <div className="flex flex-col gap-1 border-t border-border px-3 py-1.5">
          {outputs.map((h) => (
            <span key={h} className={cn("text-right text-xs", h === "error" ? "text-danger-fg dark:text-danger" : "text-fg-muted")}>{HANDLE_LABELS[h]}</span>
          ))}
        </div>
      )}
      {outputs.map((h, i) => (
        <Handle
          key={h}
          id={h}
          type="source"
          position={Position.Right}
          isConnectable={!readOnly}
          style={outputs.length > 1 ? { top: `calc(100% - ${(outputs.length - i) * 20 - 4}px)`, borderColor: h === "error" ? "var(--danger)" : h === "false" || h === "each" ? "var(--warning)" : undefined } : undefined}
        />
      ))}
    </div>
  );
});
