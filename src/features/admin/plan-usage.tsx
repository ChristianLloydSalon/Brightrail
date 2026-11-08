"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Meter } from "@/components/shared/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { useWorkspaceId } from "@/hooks/use-current";
import { PLANS, planName, type PlanId } from "@/lib/domain/plans";
import { formatDate } from "@/lib/format";
import { errorMessage, planApi } from "@/lib/services";
import { cn } from "@/lib/utils";

/** Settings → Plan & usage. Usage meters plus Free/Team plans; owners switch directly (no payment step). */
export function PlanUsageView() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["plan", ws], queryFn: () => planApi.usage() });
  const [target, setTarget] = React.useState<PlanId | null>(null);
  const change = useMutation({
    mutationFn: (p: PlanId) => planApi.change(p),
    onSuccess: async (r) => { await qc.invalidateQueries(); setTarget(null); toast.success(`You're on the ${planName(r.plan)} plan`, { description: "New limits apply right away." }); },
    onError: (e) => { setTarget(null); toast.error(errorMessage(e)); },
  });

  if (q.isError) return <PageContainer><Panel><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Panel></PageContainer>;
  if (!q.data) return <PageContainer><LoadingBlock rows={6} label="Loading plan and usage" /></PageContainer>;
  const d = q.data;
  const t = target ? PLANS[target] : null;
  const over = t ? (["executions", "members", "connections"] as const).filter((k) => d.usage[k] > t.quotas[k === "executions" ? "executionsPerMonth" : k]) : [];

  return (
    <PageContainer>
      <PageHeader title="Plan & usage" description="What this workspace uses this month, and the limits of its plan." />
      <div className="flex flex-col gap-5">
        <Panel aria-labelledby="use-h">
          <PanelHeader id="use-h" title={<span className="inline-flex items-center gap-2">Usage <Badge tone="neutral">{planName(d.plan)} plan</Badge></span>} description={`Runs reset on ${formatDate(d.resetsAt)} (UTC).`} />
          <PanelBody className="grid gap-5 sm:grid-cols-3">
            <Meter label="Runs this month" value={d.usage.executions} max={d.quotas.executionsPerMonth} />
            <Meter label="Members" value={d.usage.members} max={d.quotas.members} />
            <Meter label="Connections" value={d.usage.connections} max={d.quotas.connections} />
          </PanelBody>
        </Panel>

        <div className="grid gap-5 md:grid-cols-2">
          {(Object.values(PLANS)).map((p) => {
            const current = d.plan === p.id;
            return (
              <Panel key={p.id} aria-labelledby={`plan-${p.id}`} className={cn(current && "border-primary")}>
                <PanelHeader id={`plan-${p.id}`} title={<span className="inline-flex items-center gap-2">{p.name}{current && <Badge tone="success">Current plan</Badge>}</span>} description={p.tagline} />
                <PanelBody className="flex flex-col gap-4">
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {p.features.map((f) => <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{f}</li>)}
                  </ul>
                  {!current && (d.canChange
                    ? <Button variant={p.id === "team" ? "primary" : "outline"} className="w-fit" onClick={() => setTarget(p.id)}>Switch to {p.name}</Button>
                    : <p className="text-sm text-fg-muted">Only the workspace owner can change the plan.</p>)}
                </PanelBody>
              </Panel>
            );
          })}
        </div>
        <p className="text-sm text-fg-muted">Plans only set limits inside Brightrail; switching doesn't charge anything. Your hosting providers' own free tiers (Supabase, Inngest, Vercel) still apply.</p>
      </div>
      <ConfirmDialog open={!!target} onOpenChange={(o) => !o && setTarget(null)} loading={change.isPending} onConfirm={() => { if (target) change.mutate(target); }}
        title={`Switch to ${t?.name}?`} confirmLabel={`Switch to ${t?.name}`}
        description={over.length ? `This workspace is already over the ${t?.name} limit for ${over.join(" and ")}. Nothing is deleted, but new ${over.map((k) => (k === "executions" ? "runs" : k)).join(" and ")} will be blocked until usage is below the limit.` : `New limits: ${t?.quotas.executionsPerMonth.toLocaleString()} runs a month, ${t?.quotas.members} members, ${t?.quotas.connections} connections.`} />
    </PageContainer>
  );
}
