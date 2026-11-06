"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FilterX, MousePointerClick, Plus, Timer, Webhook, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { RelativeTime } from "@/components/shared/time";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, Panel } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import { useDebounced, useUrlState } from "@/hooks/use-url-state";
import { RUN_STATUS_META, WORKFLOW_STATUS_META } from "@/lib/domain/status";
import { WORKFLOW_STATUSES, type WorkflowStatus } from "@/lib/domain/types";
import { workflowsApi } from "@/lib/services";
import type { WorkflowListItem, WorkflowSortKey } from "@/lib/services/types";
import { CreateWorkflowDialog } from "./create-workflow-dialog";

const DEFAULTS = { q: "", status: "all", owner: "all", sort: "updatedAt", dir: "desc", page: "1", size: "10" };

export function WorkflowList() {
  const ws = useWorkspaceId();
  const { can } = useCurrent();
  const [st, set] = useUrlState(DEFAULTS);
  const [search, setSearch] = React.useState(st.q);
  const debounced = useDebounced(search);
  const [createOpen, setCreateOpen] = React.useState(false);
  React.useEffect(() => { if (debounced !== st.q) set({ q: debounced }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = { search: st.q, status: st.status as WorkflowStatus | "all", ownerId: st.owner, sort: st.sort as WorkflowSortKey, dir: st.dir as "asc" | "desc", page: Number(st.page), pageSize: Number(st.size) };
  const q = useQuery({ queryKey: ["workflows", ws, params], queryFn: () => workflowsApi.list(params), placeholderData: keepPreviousData });
  const owners = useQuery({ queryKey: ["workflow-owners", ws], queryFn: () => workflowsApi.owners() });
  const filtered = st.q || st.status !== "all" || st.owner !== "all";

  const columns: Column<WorkflowListItem>[] = [
    {
      id: "name", header: "Workflow", sortable: true,
      cell: (w) => (
        <div className="flex min-w-0 flex-col gap-0.5 py-1">
          <Link href={`/workflows/${w.id}`} className="font-medium hover:underline">{w.name}</Link>
          <span className="line-clamp-1 max-w-md text-sm text-fg-muted">{w.description || "No description"}</span>
        </div>
      ),
    },
    { id: "status", header: "Status", sortable: true, cell: (w) => <StatusBadge meta={WORKFLOW_STATUS_META[w.status]} /> },
    {
      id: "trigger", header: "Trigger", hideBelow: "xl",
      cell: (w) => <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">{w.triggerType === "webhook" ? <Webhook className="size-4" aria-hidden /> : w.triggerType === "schedule" ? <Timer className="size-4" aria-hidden /> : <MousePointerClick className="size-4" aria-hidden />}{w.triggerType === "webhook" ? "Webhook" : w.triggerType === "schedule" ? "Schedule" : "Manual"}{w.currentVersion ? ` · v${w.currentVersion}` : ""}</span>,
    },
    { id: "owner", header: "Owner", hideBelow: "lg", cell: (w) => <span className="flex items-center gap-2"><Avatar name={w.owner.name} size="sm" /><span className="truncate">{w.owner.name}</span></span> },
    {
      id: "lastRun", header: "Last execution", sortable: true,
      cell: (w) => w.lastRun ? (
        <Link href={`/executions/${w.lastRun.id}`} className="flex flex-col gap-0.5 hover:underline">
          <StatusBadge meta={RUN_STATUS_META[w.lastRun.status]} className="w-fit" />
          <RelativeTime iso={w.lastRun.startedAt} className="text-sm text-fg-muted" />
        </Link>
      ) : <span className="text-sm text-fg-subtle">Never run</span>,
    },
    { id: "updatedAt", header: "Updated", sortable: true, cell: (w) => <RelativeTime iso={w.updatedAt} className="text-sm text-fg-muted" /> },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Workflows"
        description="Every workflow has an editable draft and immutable published versions. Runs always use the version that was current when they started."
        actions={can("workflows.edit") && <Button onClick={() => setCreateOpen(true)}><Plus aria-hidden /> Create workflow</Button>}
      />
      <Panel>
        <div className="flex flex-col gap-3 border-b border-border p-3 md:flex-row md:items-center">
          <SearchInput label="Search workflows" placeholder="Search by name, tag or owner" value={search} onValueChange={setSearch} className="md:w-80" />
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select aria-label="Filter by status" value={st.status} onValueChange={(v) => set({ status: v })} className="sm:w-40"
              options={[{ value: "all", label: "All statuses" }, ...WORKFLOW_STATUSES.map((s) => ({ value: s, label: WORKFLOW_STATUS_META[s].label }))]} />
            <Select aria-label="Filter by owner" value={st.owner} onValueChange={(v) => set({ owner: v })} className="sm:w-44" loading={owners.isPending} error={owners.isError ? "Couldn't load owners" : null}
              options={[{ value: "all", label: "All owners" }, ...(owners.data ?? []).map((o) => ({ value: o.id, label: o.name }))]} />
            <Select aria-label="Sort by" value={`${st.sort}:${st.dir}`} onValueChange={(v) => { const [sort, dir] = v.split(":"); set({ sort: sort!, dir: dir! }); }} className="col-span-2 sm:w-48 md:hidden"
              options={[{ value: "updatedAt:desc", label: "Recently updated" }, { value: "name:asc", label: "Name A–Z" }, { value: "name:desc", label: "Name Z–A" }, { value: "lastRun:desc", label: "Last executed" }, { value: "status:asc", label: "Status" }]} />
          </div>
          {filtered && <Button variant="ghost" size="sm" className="md:ml-auto" onClick={() => { setSearch(""); set({ q: "", status: "all", owner: "all" }); }}><FilterX aria-hidden /> Clear filters</Button>}
        </div>
        <DataTable<WorkflowListItem, WorkflowSortKey>
          caption="Workflows"
          columns={columns}
          rows={q.data?.items}
          getRowId={(w) => w.id}
          isLoading={q.isPending}
          error={q.isError ? q.error : undefined}
          onRetry={() => void q.refetch()}
          sort={{ key: st.sort as WorkflowSortKey, dir: st.dir as "asc" | "desc" }}
          onSortChange={(s) => set({ sort: s.key, dir: s.dir })}
          empty={filtered ? (
            <EmptyState icon={<FilterX />} title="No workflows match" description={st.q ? `Nothing matches “${st.q}” with the current filters.` : "Try a different status or owner."} action={<Button variant="outline" onClick={() => { setSearch(""); set({ q: "", status: "all", owner: "all" }); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<WorkflowIcon />} title="No workflows yet" description="Create a workflow, add steps, then publish it to start accepting triggers." action={can("workflows.edit") && <Button onClick={() => setCreateOpen(true)}><Plus aria-hidden /> Create workflow</Button>} />
          )}
          mobileCard={(w) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/workflows/${w.id}`} className="font-medium hover:underline">{w.name}</Link>
                <StatusBadge meta={WORKFLOW_STATUS_META[w.status]} />
              </div>
              <p className="line-clamp-2 text-sm text-fg-muted">{w.description}</p>
              <p className="flex flex-wrap gap-x-3 text-sm text-fg-subtle">
                <span>{w.owner.name}</span>
                <span>Last run: {w.lastRun ? <>{RUN_STATUS_META[w.lastRun.status].label.toLowerCase()}, <RelativeTime iso={w.lastRun.startedAt} /></> : "never"}</span>
                <span>Updated <RelativeTime iso={w.updatedAt} /></span>
              </p>
            </div>
          )}
          footer={q.data && q.data.total > 0 && (
            <Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} pageSize={q.data.pageSize} onPageChange={(p) => set({ page: String(p) })} onPageSizeChange={(s) => set({ size: String(s), page: "1" })} label="Workflow pages" />
          )}
        />
      </Panel>
      <CreateWorkflowDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageContainer>
  );
}
