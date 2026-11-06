import { createNode, NODE_META } from "@/lib/domain/nodes";
import type { EdgeHandle, NodeKind, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@/lib/domain/types";

/**
 * Editor state with undo/redo. Consecutive edits to the same field are coalesced into one history
 * entry so undo steps feel natural while typing.
 */
export interface EditorState {
  def: WorkflowDefinition;
  past: WorkflowDefinition[];
  future: WorkflowDefinition[];
  lastKey: string | null;
  lastAt: number;
  dirty: boolean;
  dragOrigin?: WorkflowDefinition;
}

export type EditorAction =
  | { type: "load"; def: WorkflowDefinition }
  | { type: "addNode"; kind: NodeKind; position?: { x: number; y: number }; connectFrom?: string; id?: string }
  | { type: "updateNode"; id: string; patch: Partial<WorkflowNode>; key?: string }
  | { type: "updateConfig"; id: string; config: Record<string, unknown>; key?: string }
  | { type: "moveNodes"; positions: Record<string, { x: number; y: number }>; commit: boolean }
  | { type: "removeNodes"; ids: string[] }
  | { type: "connect"; source: string; target: string; handle: EdgeHandle }
  | { type: "setOutput"; source: string; handle: EdgeHandle; target: string | null }
  | { type: "setOutputs"; source: string; handle: EdgeHandle; targets: string[] }
  | { type: "removeEdges"; ids: string[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saved" };

const LIMIT = 100;

function commit(s: EditorState, def: WorkflowDefinition, key: string | null = null): EditorState {
  const now = Date.now();
  const coalesce = key !== null && key === s.lastKey && now - s.lastAt < 1200;
  return { def, past: coalesce ? s.past : [...s.past.slice(-LIMIT), s.def], future: [], lastKey: key, lastAt: now, dirty: true };
}

export function canConnect(def: WorkflowDefinition, source: string, target: string, handle: EdgeHandle): string | null {
  const s = def.nodes.find((n) => n.id === source);
  const t = def.nodes.find((n) => n.id === target);
  if (!s || !t) return "Step not found.";
  if (source === target) return "A step can't connect to itself.";
  if (!NODE_META[t.kind].acceptsInput) return "Nothing can connect into the trigger.";
  if (!NODE_META[s.kind].outputs.includes(handle)) return `${s.label} has no ${handle} output.`;
  // Reject edges that would create a loop.
  const adj = new Map<string, string[]>();
  for (const e of def.edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return "That connection would create a loop.";
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(adj.get(id) ?? []));
  }
  return null;
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "load":
      return { def: a.def, past: [], future: [], lastKey: null, lastAt: 0, dirty: false };
    case "saved":
      return { ...s, dirty: false };
    case "undo": {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { ...s, def: prev, past: s.past.slice(0, -1), future: [s.def, ...s.future], lastKey: null, dirty: true };
    }
    case "redo": {
      const next = s.future[0];
      if (!next) return s;
      return { ...s, def: next, past: [...s.past, s.def], future: s.future.slice(1), lastKey: null, dirty: true };
    }
    case "addNode": {
      const from = a.connectFrom ? s.def.nodes.find((n) => n.id === a.connectFrom) : undefined;
      const pos = a.position ?? (from ? { x: from.position.x + 300, y: from.position.y + (s.def.edges.filter((e) => e.source === from.id).length * 150) } : { x: (s.def.nodes.length % 4) * 300, y: Math.floor(s.def.nodes.length / 4) * 170 });
      const node = { ...createNode(a.kind, pos), ...(a.id ? { id: a.id } : {}) };
      const edges = [...s.def.edges];
      if (from && NODE_META[a.kind].acceptsInput) {
        const handle: EdgeHandle = NODE_META[from.kind].outputs.find((h) => h !== "error" && !s.def.edges.some((e) => e.source === from.id && e.sourceHandle === h)) ?? NODE_META[from.kind].outputs[0]!;
        if (a.kind === "errorHandler" && NODE_META[from.kind].outputs.includes("error")) edges.push({ id: `e_${from.id}_${node.id}_error`, source: from.id, target: node.id, sourceHandle: "error" });
        else edges.push({ id: `e_${from.id}_${node.id}_${handle}`, source: from.id, target: node.id, sourceHandle: handle });
      }
      return commit(s, { nodes: [...s.def.nodes, node], edges });
    }
    case "updateNode":
      return commit(s, { ...s.def, nodes: s.def.nodes.map((n) => (n.id === a.id ? ({ ...n, ...a.patch } as WorkflowNode) : n)) }, a.key ?? null);
    case "updateConfig":
      return commit(s, { ...s.def, nodes: s.def.nodes.map((n) => (n.id === a.id ? ({ ...n, config: { ...n.config, ...a.config } } as WorkflowNode) : n)) }, a.key ?? null);
    case "moveNodes": {
      const nodes = s.def.nodes.map((n) => (a.positions[n.id] ? { ...n, position: a.positions[n.id]! } : n));
      // Drag frames update without history; the drop commits one entry.
      if (!a.commit) return { ...s, dragOrigin: s.dragOrigin ?? s.def, def: { ...s.def, nodes } };
      return { def: { ...s.def, nodes }, past: [...s.past.slice(-LIMIT), s.dragOrigin ?? s.def], future: [], lastKey: null, lastAt: Date.now(), dirty: true };
    }
    case "removeNodes": {
      const ids = new Set(a.ids);
      return commit(s, { nodes: s.def.nodes.filter((n) => !ids.has(n.id)), edges: s.def.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)) });
    }
    case "connect": {
      if (canConnect(s.def, a.source, a.target, a.handle)) return s;
      if (s.def.edges.some((e) => e.source === a.source && e.target === a.target && e.sourceHandle === a.handle)) return s;
      // An output can fan out to several steps (they all run). Error paths lead to one handler.
      const edges = a.handle === "error" ? s.def.edges.filter((e) => !(e.source === a.source && e.sourceHandle === a.handle)) : s.def.edges;
      const edge: WorkflowEdge = { id: `e_${a.source}_${a.target}_${a.handle}`, source: a.source, target: a.target, sourceHandle: a.handle };
      return commit(s, { ...s.def, edges: [...edges, edge] });
    }
    case "setOutput": {
      const edges = s.def.edges.filter((e) => !(e.source === a.source && e.sourceHandle === a.handle));
      if (a.target && !canConnect({ ...s.def, edges }, a.source, a.target, a.handle)) edges.push({ id: `e_${a.source}_${a.target}_${a.handle}`, source: a.source, target: a.target, sourceHandle: a.handle });
      return commit(s, { ...s.def, edges });
    }
    case "setOutputs": {
      let edges = s.def.edges.filter((e) => !(e.source === a.source && e.sourceHandle === a.handle));
      for (const t of a.targets) {
        if (!canConnect({ ...s.def, edges }, a.source, t, a.handle)) edges = [...edges, { id: `e_${a.source}_${t}_${a.handle}`, source: a.source, target: t, sourceHandle: a.handle }];
      }
      return commit(s, { ...s.def, edges });
    }
    case "removeEdges": {
      const ids = new Set(a.ids);
      return commit(s, { ...s.def, edges: s.def.edges.filter((e) => !ids.has(e.id)) });
    }
  }
}

/** Steps in execution-ish order (BFS from trigger), then any unconnected steps. Used by the outline and keyboard navigation. */
export function orderedNodes(def: WorkflowDefinition): WorkflowNode[] {
  const out: WorkflowNode[] = [];
  const seen = new Set<string>();
  const trigger = def.nodes.find((n) => n.kind === "trigger");
  const queue = trigger ? [trigger.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = def.nodes.find((x) => x.id === id);
    if (n) out.push(n);
    for (const e of def.edges) if (e.source === id) queue.push(e.target);
  }
  return [...out, ...def.nodes.filter((n) => !seen.has(n.id))];
}
