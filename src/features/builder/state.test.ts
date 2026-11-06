import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/templates";
const ORDER_FULFILMENT = () => TEMPLATES.find((t) => t.id === "welcome-email")!.build();
import { canConnect, editorReducer, orderedNodes, type EditorState } from "./state";

const init = (): EditorState => editorReducer({ def: { nodes: [], edges: [] }, past: [], future: [], lastKey: null, lastAt: 0, dirty: false }, { type: "load", def: ORDER_FULFILMENT() });

describe("builder state", () => {
  it("adds a node connected after the selected one, with undo/redo", () => {
    const s1 = editorReducer(init(), { type: "addNode", kind: "delay", connectFrom: "n_email" });
    expect(s1.def.nodes).toHaveLength(4);
    expect(s1.def.edges.some((e) => e.source === "n_email")).toBe(true);
    const undone = editorReducer(s1, { type: "undo" });
    expect(undone.def.nodes).toHaveLength(3);
    expect(editorReducer(undone, { type: "redo" }).def.nodes).toHaveLength(4);
  });
  it("coalesces typing into one history entry", () => {
    let s = init();
    for (const label of ["V", "Ve", "Ver"]) s = editorReducer(s, { type: "updateNode", id: "n_email", patch: { label }, key: "n_email:label" });
    expect(s.past).toHaveLength(1);
  });
  it("blocks loops, self-connections and edges into the trigger", () => {
    const def = ORDER_FULFILMENT();
    expect(canConnect(def, "n_email", "n_wait", "default")).toMatch(/loop/);
    expect(canConnect(def, "n_email", "n_email", "default")).toMatch(/itself/);
    expect(canConnect(def, "n_email", "n_trigger", "default")).toMatch(/trigger/);
  });
  it("removing a node removes its edges", () => {
    const s = editorReducer(init(), { type: "removeNodes", ids: ["n_wait"] });
    expect(s.def.edges.some((e) => e.source === "n_wait" || e.target === "n_wait")).toBe(false);
    expect(orderedNodes(s.def)[0]!.kind).toBe("trigger");
  });
});

describe("adding a step with a known id", () => {
  it("uses the id the editor chose, so it can be selected straight away", () => {
    const s0: EditorState = { def: { nodes: [], edges: [] }, past: [], future: [], lastKey: null, lastAt: 0, dirty: false };
    const s1 = editorReducer(s0, { type: "addNode", kind: "formula", id: "formula_abc" });
    expect(s1.def.nodes.map((n) => n.id)).toEqual(["formula_abc"]);
    const s2 = editorReducer(s1, { type: "addNode", kind: "delay" });
    expect(s2.def.nodes[1]!.id).toMatch(/^delay_/);
  });
});
