import type { EdgeHandle, NodeConfigMap, NodeKind, WorkflowNode } from "./types";
import { describeSchedule } from "@/lib/engine/schedule";

export interface NodeKindMeta {
  kind: NodeKind;
  label: string;
  shortLabel: string;
  description: string;
  /** Output handles this kind exposes */
  outputs: EdgeHandle[];
  /** Whether the node accepts an incoming connection */
  acceptsInput: boolean;
  /** Only one per workflow */
  singleton?: boolean;
}

export const NODE_META: Record<NodeKind, NodeKindMeta> = {
  trigger: {
    kind: "trigger",
    label: "Trigger",
    shortLabel: "Trigger",
    description: "Starts the workflow from a manual run, a signed webhook or a schedule.",
    outputs: ["default"],
    acceptsInput: false,
    singleton: true,
  },
  http: {
    kind: "http",
    label: "HTTP request",
    shortLabel: "HTTP",
    description: "Calls an external HTTPS endpoint through the generic HTTP connector.",
    outputs: ["default", "error"],
    acceptsInput: true,
  },
  action: {
    kind: "action",
    label: "Connector action",
    shortLabel: "Action",
    description: "Runs a typed action on a connected integration (payments, invoices, email…).",
    outputs: ["default", "error"],
    acceptsInput: true,
  },
  condition: {
    kind: "condition",
    label: "Condition",
    shortLabel: "If",
    description: "Branches on a field in the run data. Exposes a true and a false path.",
    outputs: ["true", "false"],
    acceptsInput: true,
  },
  loop: {
    kind: "loop",
    label: "For each",
    shortLabel: "Loop",
    description: "Repeats the steps on its “For each item” path once per item in a list, then continues on “Next”.",
    outputs: ["each", "default"],
    acceptsInput: true,
  },
  formula: {
    kind: "formula",
    label: "Formula",
    shortLabel: "Formula",
    description: "Calculates values with safe formulas: math, text, dates and if/else. No custom code.",
    outputs: ["default", "error"],
    acceptsInput: true,
  },
  delay: {
    kind: "delay",
    label: "Delay",
    shortLabel: "Wait",
    description: "Pauses the run on a durable timer, up to 7 days.",
    outputs: ["default"],
    acceptsInput: true,
  },
  transform: {
    kind: "transform",
    label: "Transform data",
    shortLabel: "Map",
    description: "Maps and reshapes fields with a fixed set of safe functions. No custom code.",
    outputs: ["default"],
    acceptsInput: true,
  },
  errorHandler: {
    kind: "errorHandler",
    label: "Error handler",
    shortLabel: "On error",
    description: "Catches failures routed from a step's error path and decides what happens next.",
    outputs: ["default"],
    acceptsInput: true,
  },
};

export const HANDLE_LABELS: Record<EdgeHandle, string> = {
  default: "Next",
  true: "If true",
  false: "If false",
  error: "On error",
  each: "For each item",
};

export function defaultConfig<K extends NodeKind>(kind: K): NodeConfigMap[K] {
  const configs: NodeConfigMap = {
    trigger: { triggerType: "manual", eventName: "", requiredFields: [] },
    http: { method: "GET", url: "", headers: [], body: "", timeoutSec: 10, maxAttempts: 3, useIdempotencyKey: true },
    action: { inputMapping: [], timeoutSec: 15, maxAttempts: 3 },
    condition: { field: "", operator: "equals", value: "" },
    delay: { amount: 5, unit: "minutes" },
    transform: { mappings: [{ target: "", source: "", fn: "copy" }] },
    loop: { field: "", maxItems: 100 },
    formula: { assignments: [{ target: "", expression: "" }] },
    errorHandler: { strategy: "create_exception", catches: ["any"] },
  };
  return structuredClone(configs[kind]);
}

let counter = 0;
export function newNodeId(kind: NodeKind): string {
  counter += 1;
  return `${kind}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function createNode(kind: NodeKind, position: { x: number; y: number }, label?: string): WorkflowNode {
  return {
    id: newNodeId(kind),
    kind,
    position,
    label: label ?? NODE_META[kind].label,
    config: defaultConfig(kind),
  } as WorkflowNode;
}

/** Human summary of a node's configuration, used on canvas cards, the outline and screen-reader descriptions. */
export function summarizeNode(node: WorkflowNode): string {
  switch (node.kind) {
    case "trigger":
      return node.config.triggerType === "webhook"
        ? `Webhook${node.config.eventName ? ` · ${node.config.eventName}` : ""}`
        : node.config.triggerType === "schedule"
          ? describeSchedule(node.config.schedule)
          : "Manual run";
    case "http":
      return node.config.url ? `${node.config.method} ${node.config.url.replace(/^https?:\/\//, "")}` : `${node.config.method} · URL not set`;
    case "action":
      return node.config.actionKey ? node.config.actionKey : "Action not selected";
    case "condition":
      return node.config.field
        ? `${node.config.field} ${OPERATOR_LABELS[node.config.operator]}${node.config.operator === "exists" ? "" : ` ${node.config.value || "…"}`}`
        : "Condition not set";
    case "delay":
      return `Wait ${node.config.amount} ${node.config.unit}`;
    case "transform": {
      const n = node.config.mappings.filter((m) => m.target).length;
      return `${n} field mapping${n === 1 ? "" : "s"}`;
    }
    case "errorHandler":
      return ERROR_STRATEGY_LABELS[node.config.strategy];
    case "loop":
      return node.config.field ? `Each item in ${node.config.field}` : "List not set";
    case "formula": {
      const set = node.config.assignments.filter((a) => a.target);
      return set.length === 1 ? `Sets ${set[0]!.target}` : `Sets ${set.length} fields`;
    }
  }
}

export const OPERATOR_LABELS = {
  equals: "equals",
  not_equals: "does not equal",
  greater_than: "is greater than",
  less_than: "is less than",
  contains: "contains",
  exists: "exists",
} as const;

export const ERROR_STRATEGY_LABELS = {
  create_exception: "Create exception for review",
  notify: "Notify a channel",
  fallback_path: "Continue on fallback path",
  fail_run: "Fail the run",
} as const;

export const TRANSFORM_FN_LABELS = {
  copy: "Copy as-is",
  uppercase: "Uppercase",
  lowercase: "Lowercase",
  to_number: "Convert to number",
  to_string: "Convert to text",
  trim: "Trim whitespace",
  default: "Use fallback if empty",
} as const;

export const DELAY_LIMIT_SECONDS = 7 * 24 * 3600;
export const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 } as const;
