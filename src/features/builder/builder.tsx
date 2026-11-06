"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection as RFConnection, type Edge, type Node, type NodeChange, type EdgeChange,
} from "@xyflow/react";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, Keyboard, LayoutList, ListTree, Loader2, Maximize, Minus, MoreHorizontal, Network, Plus, Redo2, Rocket, Save, Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { useAnnounce } from "@/components/providers/announcer";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/card";
import { ConfirmDialog, SheetContent } from "@/components/ui/dialog";
import { Alert, ErrorState } from "@/components/ui/feedback";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import { HANDLE_LABELS, NODE_META, newNodeId, summarizeNode } from "@/lib/domain/nodes";
import { useOnChange } from "@/hooks/use-on-change";
import { WORKFLOW_STATUS_META } from "@/lib/domain/status";
import { NODE_KINDS, type EdgeHandle, type NodeKind, type WorkflowDefinition } from "@/lib/domain/types";
import { validateWorkflow } from "@/lib/domain/validation";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { errorMessage, integrationsApi, webhooksApi, workflowsApi } from "@/lib/services";
import { cn } from "@/lib/utils";
import { PublishDialog } from "@/features/workflows/publish-dialog";
import { FlowNodeCard, KindIcon, type FlowNodeData } from "./node-card";
import { NodeConfigPanel } from "./node-config";
import { canConnect, editorReducer, orderedNodes, type EditorState } from "./state";

const nodeTypes = { ff: FlowNodeCard };
const DND_MIME = "application/x-flowforge-node";

function useMedia(q: string) {
  const [m, setM] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [q]);
  return m;
}

function Palette({ onAdd, disabled, selectedLabel }: { onAdd: (k: NodeKind) => void; disabled: boolean; selectedLabel?: string }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-sm text-fg-muted">Drag onto the canvas, or press Enter to add{selectedLabel ? <> after <strong>{selectedLabel}</strong></> : ""}.</p>
      <ul className="flex flex-col gap-1.5">
        {NODE_KINDS.map((k) => (
          <li key={k}>
            <button
              type="button"
              disabled={disabled}
              draggable={!disabled}
              onDragStart={(e) => { e.dataTransfer.setData(DND_MIME, k); e.dataTransfer.effectAllowed = "move"; }}
              onClick={() => onAdd(k)}
              className="flex w-full cursor-grab items-center gap-2.5 rounded-md border border-border bg-surface p-2 text-left hover:border-border-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <KindIcon kind={k} />
              <span className="flex min-w-0 flex-col"><span className="text-base font-medium">{NODE_META[k].label}</span><span className="truncate text-xs text-fg-muted">{NODE_META[k].description}</span></span>
              <Plus className="ml-auto size-4 shrink-0 text-fg-subtle" aria-hidden />
              <span className="sr-only">Add {NODE_META[k].label} step</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Structured outline: the non-canvas way to read, select and connect every step. */
function Outline({ def, selected, onSelect, issueCount }: { def: WorkflowDefinition; selected?: string; onSelect: (id: string, open?: boolean) => void; issueCount: (id: string) => { errors: number; warnings: number } }) {
  const nodes = orderedNodes(def);
  if (!nodes.length) return <p className="p-4 text-sm text-fg-muted">No steps yet. Add a trigger to begin.</p>;
  return (
    <ol className="flex flex-col gap-1 p-2" aria-label="Workflow outline">
      {nodes.map((n, i) => {
        const outs = def.edges.filter((e) => e.source === n.id);
        const c = issueCount(n.id);
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onSelect(n.id, true)}
              aria-current={selected === n.id ? "true" : undefined}
              className={cn("flex w-full items-start gap-2.5 rounded-md p-2 text-left hover:bg-surface-hover", selected === n.id && "bg-secondary-soft hover:bg-secondary-soft")}
            >
              <span className="w-5 pt-1 text-right text-xs text-fg-subtle tabular">{i + 1}</span>
              <KindIcon kind={n.kind} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{n.label}</span>
                  {c.errors > 0 && <Badge tone="danger" className="h-5 px-1 text-xs"><AlertCircle className="size-3" aria-hidden />{c.errors}<span className="sr-only"> errors</span></Badge>}
                  {!c.errors && c.warnings > 0 && <Badge tone="warning" className="h-5 px-1 text-xs">{c.warnings}<span className="sr-only"> warnings</span></Badge>}
                </span>
                <span className="truncate text-sm text-fg-muted">{NODE_META[n.kind].label} · {summarizeNode(n)}</span>
                {outs.length > 0 && (
                  <span className="text-xs text-fg-subtle">
                    {outs.map((e) => `${HANDLE_LABELS[e.sourceHandle]} → ${def.nodes.find((x) => x.id === e.target)?.label ?? "?"}`).join(" · ")}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function CanvasControls({ readOnly }: { readOnly: boolean }) {
  const rf = useReactFlow();
  const pan = (dx: number, dy: number) => {
    const v = rf.getViewport();
    void rf.setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: 150 });
  };
  const btn = "flex size-9 items-center justify-center text-fg hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-2" role="toolbar" aria-label="Canvas view controls">
      <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        <button type="button" className={btn} onClick={() => void rf.zoomIn({ duration: 150 })} aria-label="Zoom in"><Plus className="size-4" aria-hidden /></button>
        <button type="button" className={cn(btn, "border-t border-border")} onClick={() => void rf.zoomOut({ duration: 150 })} aria-label="Zoom out"><Minus className="size-4" aria-hidden /></button>
        <button type="button" className={cn(btn, "border-t border-border")} onClick={() => void rf.fitView({ duration: 200, padding: 0.2 })} aria-label="Fit workflow to screen"><Maximize className="size-4" aria-hidden /></button>
      </div>
      <div className="hidden grid-cols-3 overflow-hidden rounded-md border border-border bg-surface shadow-sm sm:grid" aria-label="Pan canvas">
        <span /><button type="button" className={btn} onClick={() => pan(0, 120)} aria-label="Pan up"><ArrowUp className="size-4" aria-hidden /></button><span />
        <button type="button" className={btn} onClick={() => pan(120, 0)} aria-label="Pan left"><ArrowLeft className="size-4" aria-hidden /></button>
        <span className="size-9" />
        <button type="button" className={btn} onClick={() => pan(-120, 0)} aria-label="Pan right"><ArrowRight className="size-4" aria-hidden /></button>
        <span /><button type="button" className={btn} onClick={() => pan(0, -120)} aria-label="Pan down"><ArrowDown className="size-4" aria-hidden /></button><span />
      </div>
      {readOnly && <Badge tone="neutral" className="w-fit bg-surface">Read-only</Badge>}
    </div>
  );
}

function Shortcuts() {
  const rows: Array<[string, string]> = [["Ctrl/⌘ + S", "Save draft"], ["Ctrl/⌘ + Z", "Undo"], ["Ctrl/⌘ + Shift + Z", "Redo"], ["Tab", "Move focus between steps on the canvas"], ["Enter", "Open the focused step's configuration"], ["Arrow keys", "Move the selected step"], ["Delete", "Delete the selected step or connection"], ["Esc", "Close the configuration panel"]];
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label="Keyboard shortcuts"><Keyboard aria-hidden /></Button></PopoverTrigger>
      <PopoverContent className="w-80 p-3">
        <h2 className="mb-2 text-base font-semibold">Keyboard shortcuts</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          {rows.map(([k, d]) => <React.Fragment key={k}><dt><Kbd>{k}</Kbd></dt><dd className="text-fg-muted">{d}</dd></React.Fragment>)}
        </dl>
        <p className="mt-3 text-sm text-fg-muted">Every canvas action also has a form control: use the outline and each step's Connections section.</p>
      </PopoverContent>
    </Popover>
  );
}

function BuilderInner({ id }: { id: string }) {
  const ws = useWorkspaceId();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const announce = useAnnounce();
  const { can } = useCurrent();
  const rf = useReactFlow();
  const isDesktop = useMedia("(min-width: 1024px)");
  const isMobile = !useMedia("(min-width: 768px)");

  const detail = useQuery({ queryKey: ["workflow", ws, id], queryFn: () => workflowsApi.get(id), refetchOnMount: true });
  const conns = useQuery({ queryKey: ["connections", ws], queryFn: () => integrationsApi.connections() });
  const hooks = useQuery({ queryKey: ["webhooks", ws], queryFn: () => webhooksApi.list() });

  const [state, dispatch] = React.useReducer(editorReducer, { def: { nodes: [], edges: [] }, past: [], future: [], lastKey: null, lastAt: 0, dirty: false } as EditorState);
  const [revision, setRevision] = React.useState(0);
  const [viewVersion, setViewVersion] = React.useState<string>("draft");
  const [selected, setSelected] = React.useState<string>();
  const [configOpen, setConfigOpen] = React.useState(false);
  const [mobileView, setMobileView] = React.useState<"outline" | "canvas">("outline");
  const [leftTab, setLeftTab] = React.useState<"add" | "outline">("add");
  const [issuesOpen, setIssuesOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  // Load the workflow into the editor once, when it first arrives (later refetches don't overwrite edits).
  const ready = !!detail.data;
  useOnChange(ready, (isReady) => {
    if (!isReady || !detail.data) return;
    const v = params.get("version");
    const ver = v ? detail.data.versions.find((x) => String(x.version) === v) : undefined;
    setViewVersion(ver ? ver.id : "draft");
    dispatch({ type: "load", def: structuredClone(ver ? ver.definition : detail.data.workflow.draft) });
    setRevision(detail.data.workflow.draftRevision);
    const node = params.get("node");
    if (node) { setSelected(node); setConfigOpen(true); }
  });
  React.useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void rf.fitView({ padding: 0.2 }), 50);
    return () => clearTimeout(t);
  }, [ready, rf]);

  const wf = detail.data?.workflow;
  const readOnly = viewVersion !== "draft" || !can("workflows.edit") || wf?.status === "archived";
  const def = state.def;
  const validation = React.useMemo(() => validateWorkflow(def, { connections: conns.data ?? [], integrations: INTEGRATIONS }), [def, conns.data]);
  const issueCount = React.useCallback((nid: string) => ({ errors: validation.errors.filter((i) => i.nodeId === nid).length, warnings: validation.warnings.filter((i) => i.nodeId === nid).length }), [validation]);
  const selectedNode = def.nodes.find((n) => n.id === selected);

  const save = useMutation({
    mutationFn: () => workflowsApi.saveDraft(id, def, revision),
    onSuccess: (r) => { setRevision(r.revision); dispatch({ type: "saved" }); void qc.invalidateQueries({ queryKey: ["workflow"] }); toast.success("Draft saved", { description: `Revision r${r.revision}. Publish to make it live.` }); announce("Draft saved."); },
    onError: (e) => toast.error("Couldn't save", { description: errorMessage(e) }),
  });

  // Warn before leaving with unsaved changes.
  React.useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (state.dirty) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [state.dirty]);

  const select = React.useCallback((nid?: string, open = false) => {
    setSelected(nid);
    if (nid && open) setConfigOpen(true);
    const n = def.nodes.find((x) => x.id === nid);
    if (n) announce(`Selected ${NODE_META[n.kind].label} step ${n.label}.`);
  }, [def.nodes, announce]);

  const addNode = (kind: NodeKind, position?: { x: number; y: number }) => {
    if (readOnly) return;
    if (kind === "trigger" && def.nodes.some((n) => n.kind === "trigger")) { toast.error("A workflow can only have one trigger."); return; }
    const id = newNodeId(kind);
    dispatch({ type: "addNode", kind, position, connectFrom: position ? undefined : selected, id });
    setSelected(id);
    setConfigOpen(true);
    announce(`Added ${NODE_META[kind].label} step${selectedNode && !position ? ` after ${selectedNode.label}` : ""}.`);
  };

  const removeNode = (nid: string) => {
    const n = def.nodes.find((x) => x.id === nid);
    dispatch({ type: "removeNodes", ids: [nid] });
    setSelected(undefined);
    setConfigOpen(false);
    setDeleteId(null);
    toast(`Deleted “${n?.label}”`, { action: { label: "Undo", onClick: () => dispatch({ type: "undo" }) } });
    announce(`Deleted ${n?.label}. Press Control Z to undo.`);
  };

  // Keyboard shortcuts
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, [contenteditable=true], [role=combobox], [role=listbox]");
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); if (!readOnly && state.dirty) save.mutate(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); dispatch({ type: "undo" }); announce("Undo."); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); dispatch({ type: "redo" }); announce("Redo."); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [readOnly, state.dirty, save, announce]);

  // React Flow hides a node until it knows its size. We rebuild node objects from editor state, so we
  // carry the measured size along; otherwise every drag frame re-hides and re-measures every node
  // (visible as flicker).
  const [sizes, setSizes] = React.useState<Record<string, { width: number; height: number }>>({});
  const rfNodes: Node<FlowNodeData>[] = React.useMemo(() => def.nodes.map((n) => {
    const { errors, warnings } = issueCount(n.id);
    return {
      id: n.id, type: "ff", position: n.position, selected: n.id === selected, draggable: !readOnly,
      ...(sizes[n.id] ? { measured: sizes[n.id] } : {}),
      data: { node: n, readOnly, errors, warnings },
      ariaLabel: `${NODE_META[n.kind].label} step: ${n.label}. ${summarizeNode(n)}.${errors ? ` ${errors} errors.` : ""} Press Enter to configure.`,
    };
  }), [def.nodes, selected, readOnly, issueCount, sizes]);
  const rfEdges: Edge[] = React.useMemo(() => def.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle,
    label: e.sourceHandle !== "default" ? HANDLE_LABELS[e.sourceHandle] : undefined,
    labelBgStyle: { fill: "var(--surface)" }, labelStyle: { fill: "var(--text-muted)", fontSize: 11 },
    style: e.sourceHandle === "error" ? { stroke: "var(--danger)", strokeDasharray: "5 4" } : e.sourceHandle === "false" ? { strokeDasharray: "4 3" } : undefined,
    ariaLabel: `Connection from ${def.nodes.find((n) => n.id === e.source)?.label} ${HANDLE_LABELS[e.sourceHandle].toLowerCase()} to ${def.nodes.find((n) => n.id === e.target)?.label}`,
    deletable: !readOnly,
  })), [def, readOnly]);

  const onNodesChange = (changes: NodeChange[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    let commit = false;
    for (const c of changes) {
      if (c.type === "position" && c.position) { positions[c.id] = c.position; if (c.dragging === false) commit = true; }
      if (c.type === "position" && c.dragging === false && !c.position) commit = true;
      if (c.type === "select" && c.selected) setSelected(c.id);
      if (c.type === "dimensions" && c.dimensions) {
        const d = c.dimensions;
        setSizes((prev) => (prev[c.id]?.width === d.width && prev[c.id]?.height === d.height ? prev : { ...prev, [c.id]: { width: d.width, height: d.height } }));
      }
    }
    if (Object.keys(positions).length || commit) dispatch({ type: "moveNodes", positions, commit });
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
    if (removed.length && !readOnly) { dispatch({ type: "removeEdges", ids: removed }); announce("Connection removed."); }
  };
  const onConnect = (c: RFConnection) => {
    const handle = (c.sourceHandle ?? "default") as EdgeHandle;
    const why = canConnect(def, c.source, c.target, handle);
    if (why) { toast.error("Can't connect", { description: why }); return; }
    dispatch({ type: "connect", source: c.source, target: c.target, handle });
    announce(`Connected ${def.nodes.find((n) => n.id === c.source)?.label} to ${def.nodes.find((n) => n.id === c.target)?.label}.`);
  };

  if (detail.isError) return <div className="p-6"><ErrorState title="Couldn't open the editor" error={detail.error} onRetry={() => void detail.refetch()} /></div>;
  if (!wf) return <div className="flex h-dvh items-center justify-center" role="status"><Loader2 className="size-6 animate-spin text-fg-muted" aria-hidden /><span className="sr-only">Loading editor</span></div>;

  const nextVersion = (detail.data!.versions[0]?.version ?? 0) + 1;
  const validationBadge = validation.valid ? (
    <span className="inline-flex items-center gap-1 text-sm text-success-fg dark:text-success"><CheckCircle2 className="size-4" aria-hidden />Valid{validation.warnings.length ? ` · ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}` : ""}</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm text-danger-fg dark:text-danger"><AlertCircle className="size-4" aria-hidden />{validation.errors.length} error{validation.errors.length === 1 ? "" : "s"}</span>
  );

  const configPanel = selectedNode && (
    <NodeConfigPanel
      node={selectedNode} def={def} dispatch={dispatch} issues={validation.issues} readOnly={readOnly}
      connections={conns.data ?? []} webhooks={hooks.data ?? []} workflowId={id}
      onDelete={() => setDeleteId(selectedNode.id)} onClose={() => { setConfigOpen(false); if (!isDesktop) setSelected(undefined); }}
    />
  );

  const canvas = (
    <div
      className="relative h-full w-full"
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
      onDrop={(e) => {
        const kind = e.dataTransfer.getData(DND_MIME) as NodeKind;
        if (!kind) return;
        e.preventDefault();
        addNode(kind, rf.screenToFlowPosition({ x: e.clientX - 120, y: e.clientY - 30 }));
      }}
      onKeyDown={(e) => {
        const el = (e.target as HTMLElement).closest(".react-flow__node");
        if (el && e.key === "Enter") { e.preventDefault(); select(el.getAttribute("data-id") ?? undefined, true); }
        if (e.key === "Escape") setConfigOpen(false);
        if ((e.key === "Delete" || e.key === "Backspace") && el && !readOnly) { e.preventDefault(); setDeleteId(el.getAttribute("data-id")); }
      }}
    >
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onNodeClick={(_, n) => select(n.id, true)} onPaneClick={() => { setSelected(undefined); if (!isDesktop) setConfigOpen(false); }}
        nodesConnectable={!readOnly} nodesDraggable={!readOnly} elementsSelectable deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
        onNodesDelete={(ns) => { if (!readOnly) ns.forEach((n) => setDeleteId(n.id)); }}
        fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={1.8} proOptions={{ hideAttribution: true }}
        aria-label={`Workflow canvas for ${wf.name}. ${def.nodes.length} steps.`}
        ariaLabelConfig={{ "node.a11yDescription.default": "Press Enter to configure, arrow keys to move when selected.", "edge.a11yDescription.default": "Press Delete to remove this connection." }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--canvas-dot)" />
        {isDesktop && <MiniMap pannable zoomable ariaLabel="Workflow minimap" nodeColor="#a29d96" nodeStrokeColor="#78736c" maskColor="rgb(120 115 108 / 0.15)" />}
      </ReactFlow>
      <CanvasControls readOnly={readOnly} />
      {def.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="pointer-events-auto max-w-sm rounded-lg border border-dashed border-border-strong bg-surface p-5 text-center">
            <p className="font-semibold">Start with a trigger</p>
            <p className="mt-1 text-sm text-fg-muted">Drag a trigger from the palette, or add one with the button below.</p>
            {!readOnly && <Button className="mt-3" onClick={() => addNode("trigger")}><Plus aria-hidden /> Add trigger</Button>}
          </div>
        </div>
      )}
    </div>
  );

  const versionOptions = [{ value: "draft", label: `Draft · r${revision}${state.dirty ? " (unsaved)" : ""}` }, ...detail.data!.versions.map((v) => ({ value: v.id, label: `v${v.version}${v.id === wf.currentVersionId ? " · current" : ""}`, description: v.changeNote }))];

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Toolbar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 sm:px-3">
        <Tooltip content="Back to workflow"><Button variant="ghost" size="icon" asChild><Link href={`/workflows/${id}`} aria-label="Back to workflow details"><ArrowLeft aria-hidden /></Link></Button></Tooltip>
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-base font-semibold">{wf.name}</h1>
          <div className="flex items-center gap-2"><StatusBadge meta={WORKFLOW_STATUS_META[wf.status]} className="h-5 text-xs" /><span className="hidden sm:inline">{validationBadge}</span></div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Select aria-label="Version" value={viewVersion} size="sm" className="hidden w-48 md:flex" options={versionOptions}
            onValueChange={(v) => {
              if (state.dirty && viewVersion === "draft" && !window.confirm("You have unsaved changes. Discard them and view this version?")) return;
              setViewVersion(v);
              const ver = detail.data!.versions.find((x) => x.id === v);
              dispatch({ type: "load", def: structuredClone(ver ? ver.definition : detail.data!.workflow.draft) });
              setSelected(undefined);
              announce(ver ? `Viewing version ${ver.version}, read-only.` : "Editing the draft.");
              setTimeout(() => void rf.fitView({ padding: 0.2, duration: 200 }), 30);
            }} />
          {!readOnly && (
            <>
              <Tooltip content="Undo (Ctrl+Z)"><Button variant="ghost" size="icon" onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} aria-label="Undo"><Undo2 aria-hidden /></Button></Tooltip>
              <Tooltip content="Redo (Ctrl+Shift+Z)"><Button variant="ghost" size="icon" onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} aria-label="Redo"><Redo2 aria-hidden /></Button></Tooltip>
            </>
          )}
          <Shortcuts />
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => { setIssuesOpen(true); announce(validation.valid ? "Validation passed." : `${validation.errors.length} validation errors.`); }}>
            {validation.valid ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />} Validate
          </Button>
          {!readOnly && <Button variant="outline" size="sm" onClick={() => save.mutate()} disabled={!state.dirty} loading={save.isPending} aria-label={state.dirty ? "Save" : "Saved"}><Save aria-hidden /><span className="hidden sm:inline">{state.dirty ? "Save" : "Saved"}</span></Button>}
          {!readOnly && can("workflows.publish") && (
            <Button size="sm" aria-label="Publish" onClick={async () => { if (state.dirty) { try { const r = await save.mutateAsync(); setRevision(r.revision); } catch { return; } } setPublishOpen(true); }}>
              <Rocket aria-hidden /><span className="hidden sm:inline">Publish</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="md:hidden" aria-label="More editor actions"><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setIssuesOpen(true)}><AlertCircle aria-hidden /> Validation results</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Version</DropdownMenuLabel>
              {versionOptions.map((o) => <DropdownMenuItem key={o.value} onSelect={() => router.push(`/workflows/${id}/edit${o.value === "draft" ? "" : `?version=${detail.data!.versions.find((v) => v.id === o.value)?.version}`}`)}>{o.label}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {readOnly && (
        <div className="border-b border-border bg-info-soft px-4 py-2 text-sm text-info-fg" role="status">
          {viewVersion !== "draft" ? <>Viewing a published version. It's immutable. <button type="button" className="underline" onClick={() => { setViewVersion("draft"); dispatch({ type: "load", def: structuredClone(wf.draft) }); }}>Switch to the draft</button> to make changes.</> : wf.status === "archived" ? "Archived workflows are read-only." : "Your role can view this workflow but not edit it."}
        </div>
      )}

      {/* Mobile view switcher */}
      {isMobile && (
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <div role="tablist" aria-label="Editor view" className="inline-flex rounded-md bg-surface-sunken p-1">
            {(["outline", "canvas"] as const).map((v) => (
              <button key={v} role="tab" aria-selected={mobileView === v} type="button" onClick={() => setMobileView(v)} className={cn("flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm font-medium text-fg-muted", mobileView === v && "bg-surface text-fg shadow-xs")}>
                {v === "outline" ? <ListTree className="size-4" aria-hidden /> : <Network className="size-4" aria-hidden />}{v === "outline" ? "Outline" : "Canvas"}
              </button>
            ))}
          </div>
          <span className="ml-auto">{validationBadge}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Left sidebar (desktop) */}
        {isDesktop && (
          <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface" aria-label="Steps">
            <div role="tablist" aria-label="Sidebar" className="flex border-b border-border">
              {([["add", "Add steps", Plus], ["outline", "Outline", LayoutList]] as const).map(([k, l, I]) => (
                <button key={k} role="tab" type="button" aria-selected={leftTab === k} aria-controls={`left-${k}`} id={`left-tab-${k}`} onClick={() => setLeftTab(k)}
                  className={cn("flex h-11 flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent text-sm font-medium text-fg-muted", leftTab === k && "border-primary text-fg")}>
                  <I className="size-4" aria-hidden />{l}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto" role="tabpanel" id={`left-${leftTab}`} aria-labelledby={`left-tab-${leftTab}`}>
              {leftTab === "add" ? <Palette onAdd={(k) => addNode(k)} disabled={readOnly} selectedLabel={selectedNode?.label} /> : <Outline def={def} selected={selected} onSelect={select} issueCount={issueCount} />}
            </div>
          </aside>
        )}

        {/* Main area */}
        <main id="main" className="relative min-w-0 flex-1">
          {isMobile && mobileView === "outline" ? (
            <div className="h-full overflow-y-auto pb-24">
              <Outline def={def} selected={selected} onSelect={select} issueCount={issueCount} />
            </div>
          ) : canvas}
          {!isDesktop && !readOnly && (
            <Button className="absolute right-4 bottom-4 z-10 h-12 rounded-full px-5 shadow-lg" onClick={() => setAddOpen(true)}><Plus aria-hidden /> Add step</Button>
          )}
        </main>

        {/* Config panel: persistent on desktop */}
        {isDesktop && selectedNode && configOpen && (
          <aside className="w-[380px] shrink-0 border-l border-border bg-surface" aria-labelledby="cfg-h">{configPanel}</aside>
        )}
      </div>

      {/* Tablet & mobile: config as a sheet (bottom on phones, side on tablets) */}
      {!isDesktop && (
        <DialogPrimitive.Root open={!!selectedNode && configOpen} onOpenChange={(o) => { setConfigOpen(o); }}>
          <SheetContent side="responsive" widthClass="md:max-w-md" aria-describedby={undefined}>
            <DialogPrimitive.Title className="sr-only">Configure {selectedNode?.label}</DialogPrimitive.Title>
            <div className="flex h-full max-h-[88dvh] flex-col md:max-h-none">{configPanel}</div>
          </SheetContent>
        </DialogPrimitive.Root>
      )}

      {/* Add step sheet (tablet & mobile) */}
      <DialogPrimitive.Root open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent side="responsive" widthClass="md:max-w-sm" aria-describedby={undefined}>
          <DialogPrimitive.Title className="border-b border-border p-4 text-md font-semibold">Add a step</DialogPrimitive.Title>
          <div className="overflow-y-auto"><Palette onAdd={(k) => { setAddOpen(false); addNode(k); }} disabled={readOnly} selectedLabel={selectedNode?.label} /></div>
        </SheetContent>
      </DialogPrimitive.Root>

      {/* BUILDER-03: validation results */}
      <DialogPrimitive.Root open={issuesOpen} onOpenChange={setIssuesOpen}>
        <SheetContent side="responsive" widthClass="md:max-w-md" aria-describedby={undefined}>
          <div className="border-b border-border p-4 pr-12">
            <DialogPrimitive.Title className="text-md font-semibold">Validation</DialogPrimitive.Title>
            <p className="text-sm text-fg-muted">Checked against the current editor state, including unsaved changes. The server re-validates when you publish.</p>
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto p-4">
            {validation.valid ? <Alert tone="success" title="Ready to publish">No errors found.{validation.warnings.length ? ` Review ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.` : ""}</Alert> : <Alert tone="danger" title={`${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"} block publishing`} />}
            <ul className="flex flex-col gap-1.5">
              {validation.issues.map((i) => (
                <li key={i.id}>
                  <button type="button" disabled={!i.nodeId} onClick={() => { setIssuesOpen(false); if (i.nodeId) { select(i.nodeId, true); const n = def.nodes.find((x) => x.id === i.nodeId); if (n) void rf.setCenter(n.position.x + 120, n.position.y + 40, { zoom: 1, duration: 250 }); } }}
                    className="flex w-full items-start gap-2 rounded-md border border-border p-2.5 text-left text-base hover:bg-surface-hover disabled:cursor-default">
                    {i.severity === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
                    <span><span className="sr-only">{i.severity}: </span>{i.message}{i.nodeId && <span className="mt-0.5 block text-sm text-link">Go to step</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </SheetContent>
      </DialogPrimitive.Root>

      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} destructive title="Delete this step?" confirmLabel="Delete step"
        description={`“${def.nodes.find((n) => n.id === deleteId)?.label}” and its connections will be removed. You can undo this.`} onConfirm={() => { if (deleteId) removeNode(deleteId); }} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} workflowId={id} revision={revision} nextVersion={nextVersion}
        onFixIssue={(nid) => select(nid, true)} onPublished={() => { void detail.refetch(); }} />
      {state.dirty && <p className="sr-only" role="status">Unsaved changes</p>}
    </div>
  );
}

export function WorkflowBuilder({ id }: { id: string }) {
  return (
    <ReactFlowProvider>
      <BuilderInner id={id} />
    </ReactFlowProvider>
  );
}
