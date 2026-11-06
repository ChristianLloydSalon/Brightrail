"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLiveInterval } from "@/lib/realtime";
import { AlertTriangle, FilterX, History } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { RelativeTime } from "@/components/shared/time";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RUN_STATUS_META } from "@/lib/domain/status";
import { RUN_STATUSES, type RunStatus, type TriggerSource } from "@/lib/domain/types";
import { formatMs } from "@/lib/format";
import { runsApi, workflowsApi } from "@/lib/services";
import type { RunListItem, RunSortKey } from "@/lib/services/types";
import { useDebounced } from "@/hooks/use-url-state";
import { useWorkspaceId } from "@/hooks/use-current";

export const TRIGGER_LABELS: Record<TriggerSource, string> = { manual: "Manual", webhook: "Webhook", schedule: "Schedule", retry: "Retry", ai_recovery: "AI recovery" };

export interface RunsFilter { q: string; status: string; workflow: string; trigger: string; from: string; to: string; sort: string; dir: string; page: string; size: string }
export const RUN_FILTER_DEFAULTS: RunsFilter = { q: "", status: "all", workflow: "all", trigger: "all", from: "", to: "", sort: "startedAt", dir: "desc", page: "1", size: "15" };

/** EXEC-01 table. Filter state is owned by the caller (URL on the page, local state when embedded). */
export function RunsTable({ state, set, workflowId, compact }: { state: RunsFilter; set: (p: Partial<RunsFilter>) => void; workflowId?: string; compact?: boolean }) {
  const ws = useWorkspaceId();
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search);
  React.useEffect(() => { if (debounced !== state.q) set({ q: debounced, page: "1" }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dateErr, setDateErr] = React.useState<string | null>(null);

  const params = { search: state.q, status: state.status as RunStatus | "all", workflowId: workflowId ?? state.workflow, trigger: state.trigger as TriggerSource | "all", from: state.from || undefined, to: state.to || undefined, sort: state.sort as RunSortKey, dir: state.dir as "asc" | "desc", page: Number(state.page), pageSize: Number(state.size) };
  const activeInterval = useLiveInterval(4000, 30_000);
  const idleInterval = useLiveInterval(30_000, 120_000);
  const q = useQuery({ queryKey: ["runs", ws, params], queryFn: () => runsApi.list(params), placeholderData: keepPreviousData, refetchInterval: (query) => (query.state.data?.items.some((r) => ["queued", "running", "retrying"].includes(r.status)) ? activeInterval : idleInterval) });
  const wfs = useQuery({ queryKey: ["workflows", ws, "all-for-filter"], queryFn: () => workflowsApi.list({ pageSize: 200, sort: "name", dir: "asc" }), enabled: !workflowId });
  const filtered = state.q || state.status !== "all" || (!workflowId && state.workflow !== "all") || state.trigger !== "all" || state.from || state.to;
  const clear = () => { setSearch(""); set({ q: "", status: "all", workflow: "all", trigger: "all", from: "", to: "", page: "1" }); };

  const columns: Column<RunListItem>[] = [
    { id: "status", header: "Status", sortable: true, cell: (r) => <StatusBadge meta={RUN_STATUS_META[r.status]} /> },
    {
      id: "workflow", header: compact ? "Run" : "Workflow", sortable: !compact,
      cell: (r) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link href={`/executions/${r.id}`} className="font-medium hover:underline">{compact ? r.id : r.workflowName}<span className="sr-only">, run {r.id}</span></Link>
          {!compact && <span className="font-mono text-xs text-fg-subtle">{r.id} · v{r.version}</span>}
          {r.failedStep && <span className="inline-flex items-center gap-1 text-sm text-danger-fg dark:text-danger"><AlertTriangle className="size-3.5" aria-hidden />{r.failedStep} · <Mono>{r.errorCode}</Mono></span>}
        </div>
      ),
    },
    { id: "trigger", header: "Trigger", hideBelow: "lg", cell: (r) => <span className="text-sm text-fg-muted">{TRIGGER_LABELS[r.trigger]}</span> },
    { id: "startedAt", header: "Started", sortable: true, cell: (r) => <RelativeTime iso={r.startedAt} className="text-sm" /> },
    { id: "completed", header: "Completed", hideBelow: "xl", cell: (r) => <RelativeTime iso={r.endedAt} className="text-sm text-fg-muted" /> },
    { id: "duration", header: "Duration", sortable: true, align: "right", cell: (r) => <span className="text-sm tabular">{r.durationMs === null ? "—" : formatMs(r.durationMs)}</span> },
  ];

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-border p-3 xl:flex-row xl:flex-wrap xl:items-end">
        <SearchInput label="Search runs" placeholder="Run ID, workflow or error code" value={search} onValueChange={setSearch} className="xl:w-72" />
        <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <Select aria-label="Filter by status" value={state.status} onValueChange={(v) => set({ status: v, page: "1" })} className="sm:w-48"
            options={[{ value: "all", label: "All statuses" }, ...RUN_STATUSES.map((s) => ({ value: s, label: RUN_STATUS_META[s].label }))]} />
          {!workflowId && (
            <Select aria-label="Filter by workflow" value={state.workflow} onValueChange={(v) => set({ workflow: v, page: "1" })} className="sm:w-52" loading={wfs.isPending} error={wfs.isError ? "Couldn't load workflows" : null}
              options={[{ value: "all", label: "All workflows" }, ...(wfs.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]} />
          )}
          <Select aria-label="Filter by trigger" value={state.trigger} onValueChange={(v) => set({ trigger: v, page: "1" })} className="sm:w-40"
            options={[{ value: "all", label: "All triggers" }, ...(Object.keys(TRIGGER_LABELS) as TriggerSource[]).map((t) => ({ value: t, label: TRIGGER_LABELS[t] }))]} />
          <label className="flex flex-col gap-1 text-xs text-fg-muted">From
            <Input type="date" value={state.from} max={state.to || undefined} onChange={(e) => { setDateErr(state.to && e.target.value > state.to ? "Start date must be before end date." : null); set({ from: e.target.value, page: "1" }); }} className="h-9 sm:w-40" aria-describedby={dateErr ? "date-err" : undefined} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">To
            <Input type="date" value={state.to} min={state.from || undefined} onChange={(e) => { setDateErr(state.from && e.target.value < state.from ? "End date must be after start date." : null); set({ to: e.target.value, page: "1" }); }} className="h-9 sm:w-40" />
          </label>
        </div>
        {filtered && <Button variant="ghost" size="sm" onClick={clear} className="xl:ml-auto"><FilterX aria-hidden /> Clear filters</Button>}
        {dateErr && <p id="date-err" role="alert" className="w-full text-sm text-danger-fg">{dateErr}</p>}
      </div>
      <DataTable<RunListItem, RunSortKey>
        caption={compact ? "Execution history for this workflow" : "Workflow runs"}
        columns={compact ? columns.filter((c) => c.id !== "trigger") : columns}
        rows={q.data?.items}
        getRowId={(r) => r.id}
        isLoading={q.isPending}
        error={q.isError ? q.error : undefined}
        onRetry={() => void q.refetch()}
        sort={{ key: state.sort as RunSortKey, dir: state.dir as "asc" | "desc" }}
        onSortChange={(s) => set({ sort: s.key, dir: s.dir, page: "1" })}
        rowClassName={(r) => (r.hasOpenException ? "bg-danger-soft/30" : undefined)}
        empty={filtered ? (
          <EmptyState icon={<FilterX />} title="No runs match these filters" action={<Button variant="outline" onClick={clear}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={<History />} title="No runs yet" description="Runs appear here when a published workflow is triggered by a webhook or manually." />
        )}
        mobileCard={(r) => (
          <Link href={`/executions/${r.id}`} className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{r.workflowName}</span><StatusBadge meta={RUN_STATUS_META[r.status]} /></span>
            <span className="font-mono text-xs text-fg-subtle">{r.id}</span>
            {r.failedStep && <span className="text-sm text-danger-fg">{r.failedStep} · {r.errorCode}</span>}
            <span className="text-sm text-fg-muted">{TRIGGER_LABELS[r.trigger]} · <RelativeTime iso={r.startedAt} /> · {r.durationMs === null ? "in progress" : formatMs(r.durationMs)}</span>
          </Link>
        )}
        footer={q.data && q.data.total > 0 && (
          <Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} pageSize={q.data.pageSize} pageSizes={[15, 30, 50]} onPageChange={(p) => set({ page: String(p) })} onPageSizeChange={(s) => set({ size: String(s), page: "1" })} label="Run pages" />
        )}
      />
    </>
  );
}
