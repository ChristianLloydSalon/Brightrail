import type { WorkflowDefinition, WorkflowNode } from "@/lib/domain/types";
import { loopBody } from "@/lib/domain/validation";

/**
 * Order of execution for a workflow, independent of where steps actually run (Inngest in production,
 * plain functions in tests).
 *
 * - Follows each step's outputs; a condition follows only the branch it took.
 * - An output connected to several steps runs every branch (one after another, in connection order).
 * - A step where branches meet waits until every branch that can still reach it has run.
 * - A "For each" runs its "each" path once per item (self-contained body), then continues on "Next".
 */
export type Outcome = "ok" | "failed" | "cancelled";

export interface WalkOps {
  /** Runs one step (including its retries/timers). `sid` is a stable, unique id for this execution. */
  exec(node: WorkflowNode, sid: string): Promise<{ ok: boolean; cancelled?: boolean; branch?: string }>;
  /** Terminal failure; may name an error handler whose "Next" path continues the run. */
  fail(node: WorkflowNode, sid: string): Promise<{ continueFrom?: string }>;
  loopBegin(node: WorkflowNode, sid: string): Promise<number>;
  loopItem(node: WorkflowNode, index: number, sid: string, bodyIds: string[]): Promise<void>;
  loopEnd(node: WorkflowNode, sid: string): Promise<void>;
}

export function createWalker(def: WorkflowDefinition, ops: WalkOps) {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const bodies = new Map(def.nodes.filter((n) => n.kind === "loop").map((n) => [n.id, loopBody(def, n.id)]));

  const reachableFrom = (starts: string[], scope: Set<string> | null) => {
    const seen = new Set<string>();
    const q = [...starts];
    while (q.length) {
      const id = q.shift()!;
      if (seen.has(id) || (scope && !scope.has(id))) continue;
      seen.add(id);
      for (const e of def.edges) if (e.source === id && e.sourceHandle !== "each") q.push(e.target);
    }
    return seen;
  };

  /** A retry of a step inside a loop restarts the outermost loop around it. */
  const resumePoint = (nodeId: string) => {
    for (const [loopId, body] of bodies) if (body.has(nodeId) && ![...bodies.values()].some((b) => b.has(loopId))) return loopId;
    return nodeId;
  };

  const walk = async (starts: string[], prefix: string, scope: Set<string> | null): Promise<Outcome> => {
    const queue = [...starts];
    const visited = new Set<string>();
    let deferrals = 0;
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id) || (scope && !scope.has(id))) continue;
      const others = queue.filter((q) => q !== id);
      const waiting = others.length > 0 && def.edges.some((e) => e.target === id && !visited.has(e.source) && reachableFrom(others, scope).has(e.source));
      if (waiting && deferrals++ < 10_000) {
        queue.push(id);
        continue;
      }
      visited.add(id);
      const node = byId.get(id);
      if (!node || node.kind === "errorHandler") continue;
      const sid = `${prefix}${id}`;

      const result = await ops.exec(node, sid);
      if (result.cancelled) return "cancelled";
      if (!result.ok) {
        const out = await ops.fail(node, sid);
        if (!out.continueFrom) return "failed";
        for (const e of def.edges) if (e.source === out.continueFrom && e.sourceHandle === "default") queue.push(e.target);
        continue;
      }
      if (node.kind === "loop") {
        const body = bodies.get(id)!;
        const count = await ops.loopBegin(node, sid);
        const firsts = def.edges.filter((e) => e.source === id && e.sourceHandle === "each").map((e) => e.target);
        for (let i = 0; i < count; i++) {
          await ops.loopItem(node, i, `${sid}:i${i}`, [...body]);
          const r = await walk(firsts, `${sid}:i${i}:`, body);
          if (r !== "ok") return r;
        }
        await ops.loopEnd(node, sid);
      }
      const handles = node.kind === "condition" ? [result.branch] : ["default"];
      for (const e of def.edges) if (e.source === id && handles.includes(e.sourceHandle)) queue.push(e.target);
    }
    return "ok";
  };

  return { walk, resumePoint };
}
