import { describe, expect, it } from "vitest";
import type { EdgeHandle, NodeKind, WorkflowDefinition, WorkflowNode } from "@/lib/domain/types";
import { validateWorkflow } from "@/lib/domain/validation";
import { createWalker, type WalkOps } from "./walk";

const node = (id: string, kind: NodeKind = "transform", config: Record<string, unknown> = { mappings: [{ target: "x", source: "y", fn: "copy" }] }) =>
  ({ id, kind, label: id, position: { x: 0, y: 0 }, config }) as unknown as WorkflowNode;
const edge = (source: string, target: string, sourceHandle: EdgeHandle = "default") => ({ id: `${source}-${target}-${sourceHandle}`, source, target, sourceHandle });
const trig = () => node("T", "trigger", { triggerType: "manual", requiredFields: [] });

function run(def: WorkflowDefinition, opts: { items?: Record<string, number>; branch?: Record<string, string>; fail?: string[]; handler?: Record<string, string> } = {}) {
  const order: string[] = [];
  const sids: string[] = [];
  const ops: WalkOps = {
    exec: async (n, sid) => { order.push(n.id); sids.push(sid); return opts.fail?.includes(n.id) ? { ok: false } : { ok: true, branch: opts.branch?.[n.id] }; },
    fail: async (n) => ({ continueFrom: opts.handler?.[n.id] }),
    loopBegin: async (n) => opts.items?.[n.id] ?? 0,
    loopItem: async (n, i) => { order.push(`${n.id}#${i}`); },
    loopEnd: async (n) => { order.push(`${n.id}/end`); },
  };
  const w = createWalker(def, ops);
  return w.walk(["T"], "p0:", null).then((outcome) => ({ outcome, order, sids, resumePoint: w.resumePoint }));
}

describe("execution order", () => {
  it("runs every branch of a fan-out, then a join once, after both branches", async () => {
    const def = { nodes: [trig(), node("A"), node("B1"), node("B2"), node("B3"), node("C"), node("J")], edges: [edge("T", "A"), edge("A", "B1"), edge("B1", "B2"), edge("B2", "B3"), edge("A", "C"), edge("B3", "J"), edge("C", "J")] };
    const r = await run(def);
    expect(r.outcome).toBe("ok");
    expect(r.order.filter((x) => x === "J")).toHaveLength(1);
    expect(r.order.indexOf("J")).toBeGreaterThan(r.order.indexOf("B3"));
    expect(r.order.indexOf("J")).toBeGreaterThan(r.order.indexOf("C"));
  });

  it("only follows the condition branch taken; the join still runs", async () => {
    const def = { nodes: [trig(), node("If", "condition", { field: "a", operator: "exists", value: "" }), node("Yes"), node("No"), node("J")], edges: [edge("T", "If"), edge("If", "Yes", "true"), edge("If", "No", "false"), edge("Yes", "J"), edge("No", "J")] };
    const r = await run(def, { branch: { If: "true" } });
    expect(r.order).toEqual(["T", "If", "Yes", "J"]);
  });

  it("repeats a loop body per item with unique step ids, then continues", async () => {
    const def = { nodes: [trig(), node("L", "loop", { field: "items", maxItems: 10 }), node("X"), node("Y"), node("Z")], edges: [edge("T", "L"), edge("L", "X", "each"), edge("X", "Y"), edge("L", "Z")] };
    const r = await run(def, { items: { L: 3 } });
    expect(r.order).toEqual(["T", "L", "L#0", "X", "Y", "L#1", "X", "Y", "L#2", "X", "Y", "L/end", "Z"]);
    expect(new Set(r.sids).size).toBe(r.sids.length);
    expect(r.sids).toContain("p0:L:i2:Y");
  });

  it("supports nested loops and empty lists", async () => {
    const def = { nodes: [trig(), node("O", "loop", { field: "a", maxItems: 5 }), node("I", "loop", { field: "item.b", maxItems: 5 }), node("X"), node("Z")], edges: [edge("T", "O"), edge("O", "I", "each"), edge("I", "X", "each"), edge("O", "Z")] };
    const r = await run(def, { items: { O: 2, I: 2 } });
    expect(r.order.filter((x) => x === "X")).toHaveLength(4);
    expect(new Set(r.sids).size).toBe(r.sids.length);
    expect(r.sids).toContain("p0:O:i1:I:i1:X");
    const empty = await run(def, { items: { O: 0 } });
    expect(empty.order).toEqual(["T", "O", "O/end", "Z"]);
  });

  it("stops on a failure inside a loop; an error handler lets the run continue", async () => {
    const loopDef = { nodes: [trig(), node("L", "loop", { field: "items", maxItems: 10 }), node("X"), node("Z")], edges: [edge("T", "L"), edge("L", "X", "each"), edge("L", "Z")] };
    const r = await run(loopDef, { items: { L: 3 }, fail: ["X"] });
    expect(r.outcome).toBe("failed");
    expect(r.order).toEqual(["T", "L", "L#0", "X"]);
    expect(r.resumePoint("X")).toBe("L");

    const handled = { nodes: [trig(), node("A"), node("H", "errorHandler", { strategy: "continue", catches: ["any"] }), node("N")], edges: [edge("T", "A"), edge("A", "H", "error"), edge("H", "N")] };
    const h = await run(handled, { fail: ["A"], handler: { A: "H" } });
    expect(h.outcome).toBe("ok");
    expect(h.order).toEqual(["T", "A", "N"]);
  });

  it("validation keeps loop bodies self-contained", () => {
    const leaky = { nodes: [trig(), node("L", "loop", { field: "items", maxItems: 10 }), node("X"), node("Z")], edges: [edge("T", "L"), edge("L", "X", "each"), edge("L", "Z"), edge("Z", "X")] };
    const v = validateWorkflow(leaky as WorkflowDefinition, { connections: [], integrations: [] });
    expect(v.errors.map((e) => e.code)).toContain("LOOP_LEAK");
    const noBody = { nodes: [trig(), node("L", "loop", { field: "items", maxItems: 10 }), node("Z")], edges: [edge("T", "L"), edge("L", "Z")] };
    expect(validateWorkflow(noBody as WorkflowDefinition, { connections: [], integrations: [] }).errors.map((e) => e.code)).toContain("LOOP_EMPTY");
    const formula = { nodes: [trig(), node("F", "formula", { assignments: [{ target: "__proto__.x", expression: "1 +" }] })], edges: [edge("T", "F")] };
    const codes = validateWorkflow(formula as WorkflowDefinition, { connections: [], integrations: [] }).errors.map((e) => e.code);
    expect(codes).toContain("FORMULA");
    expect(codes).toContain("FIELD_PATH");
  });
});
