"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, FilterX, ScrollText } from "lucide-react";
import * as React from "react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, Mono, Panel } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import type { AuditCategory, AuditEvent } from "@/lib/domain/types";
import { formatDateTime } from "@/lib/format";
import { auditApi } from "@/lib/services";
import { AUDIT_CATEGORY_LABELS, describeAudit } from "./audit-describe";
import { useWorkspaceId } from "@/hooks/use-current";

const D = { q: "", category: "all", actor: "all", from: "", to: "", dir: "desc", page: "1", size: "20" };

export function AuditLogView() {
  const ws = useWorkspaceId();
  const [st, set] = useUrlState(D);
  const [search, setSearch] = React.useState(st.q);
  const deb = useDebounced(search);
  React.useEffect(() => { if (deb !== st.q) set({ q: deb }); }, [deb]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = React.useState<string | null>(null);
  const params = { search: st.q, category: st.category as AuditCategory | "all", actorId: st.actor, from: st.from || undefined, to: st.to || undefined, dir: st.dir as "asc" | "desc", page: Number(st.page), pageSize: Number(st.size) };
  const q = useQuery({ queryKey: ["audit", ws, params], queryFn: () => auditApi.list(params), placeholderData: keepPreviousData });
  const actors = useQuery({ queryKey: ["audit-actors", ws], queryFn: () => auditApi.actors() });
  const filtered = st.q || st.category !== "all" || st.actor !== "all" || st.from || st.to;
  const clear = () => { setSearch(""); set({ q: "", category: "all", actor: "all", from: "", to: "" }); };
  const cols: Column<AuditEvent>[] = [
    { id: "time", header: "Time", sortable: true, cell: (e) => <time dateTime={e.createdAt} className="text-sm whitespace-nowrap tabular">{formatDateTime(e.createdAt)}</time> },
    { id: "actor", header: "Actor", cell: (e) => <span className="flex items-center gap-2"><Avatar name={e.actor.name} size="sm" /><span className="flex flex-col"><span className="text-sm font-medium">{e.actor.name}</span><span className="text-xs text-fg-subtle capitalize">{e.actor.type === "ai" ? "AI assistant" : e.actor.type}</span></span></span> },
    { id: "event", header: "Event", cell: (e) => (
      <div className="flex flex-col gap-1">
        <span className="text-sm">{describeAudit(e)}</span>
        <span className="flex items-center gap-2"><Badge tone="neutral" className="font-mono text-xs font-normal">{e.action}</Badge>
          {Object.keys(e.metadata).length > 0 && <Button variant="link" className="h-auto text-xs" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>Details <ChevronDown className="size-3" aria-hidden /></Button>}</span>
        {open === e.id && <dl className="grid grid-cols-[auto_1fr] gap-x-3 rounded-md bg-surface-sunken p-2 text-xs">{Object.entries(e.metadata).map(([k, v]) => <React.Fragment key={k}><dt className="text-fg-muted">{k}</dt><dd className="font-mono break-all">{String(v)}</dd></React.Fragment>)}</dl>}
      </div>
    ) },
    { id: "resource", header: "Resource", hideBelow: "lg", cell: (e) => <div className="flex flex-col text-sm"><span>{e.resourceType.replace("_", " ")}</span><Mono className="w-fit text-xs">{e.resourceId}</Mono></div> },
  ];
  return (
    <PageContainer wide>
      <PageHeader title="Audit log" description="Append-only record of privileged actions, approvals and security events. Every entry is attributable to a person, service or the AI assistant." />
      <Panel>
        <div className="flex flex-col gap-2 border-b border-border p-3 lg:flex-row lg:flex-wrap lg:items-end">
          <SearchInput label="Search audit log" placeholder="Action, resource or actor" value={search} onValueChange={setSearch} className="lg:w-72" />
          <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
            <Select aria-label="Filter by category" value={st.category} onValueChange={(v) => set({ category: v })} className="sm:w-44" options={[{ value: "all", label: "All categories" }, ...(Object.keys(AUDIT_CATEGORY_LABELS) as AuditCategory[]).map((c) => ({ value: c, label: AUDIT_CATEGORY_LABELS[c] }))]} />
            <Select aria-label="Filter by actor" value={st.actor} onValueChange={(v) => set({ actor: v })} className="sm:w-48" loading={actors.isPending} options={[{ value: "all", label: "All actors" }, ...(actors.data ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
            <label className="flex flex-col gap-1 text-xs text-fg-muted">From<Input type="date" value={st.from} max={st.to || undefined} onChange={(e) => set({ from: e.target.value })} className="sm:w-40" /></label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">To<Input type="date" value={st.to} min={st.from || undefined} onChange={(e) => set({ to: e.target.value })} className="sm:w-40" /></label>
          </div>
          {filtered && <Button variant="ghost" size="sm" onClick={clear} className="lg:ml-auto"><FilterX aria-hidden /> Clear filters</Button>}
        </div>
        <DataTable caption="Audit events" columns={cols} rows={q.data?.items} getRowId={(e) => e.id} isLoading={q.isPending} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          sort={{ key: "time", dir: st.dir as "asc" | "desc" }} onSortChange={(s) => set({ dir: s.dir })}
          empty={filtered ? <EmptyState icon={<FilterX />} title="No events match" action={<Button variant="outline" onClick={clear}>Clear filters</Button>} /> : <EmptyState icon={<ScrollText />} title="No audit events yet" />}
          mobileCard={(e) => <div className="flex flex-col gap-1"><span className="text-sm"><strong>{e.actor.name}</strong> {describeAudit(e)}</span><span className="text-xs text-fg-subtle">{formatDateTime(e.createdAt)} · <span className="font-mono">{e.action}</span></span></div>}
          footer={q.data && q.data.total > 0 && <Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} pageSize={q.data.pageSize} pageSizes={[20, 50, 100]} onPageChange={(p) => set({ page: String(p) })} onPageSizeChange={(s) => set({ size: String(s), page: "1" })} label="Audit log pages" />} />
      </Panel>
    </PageContainer>
  );
}
