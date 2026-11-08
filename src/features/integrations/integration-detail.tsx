"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { RelativeTime } from "@/components/shared/time";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mono, Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { Alert, EmptyState, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import { CONNECTION_STATUS_META } from "@/lib/domain/status";
import { integrationsApi } from "@/lib/services";
import { IntegrationStatus } from "./integration-directory";
import { IntegrationLogo } from "./integration-logo";

export function IntegrationDetail({ id }: { id: string }) {
  const ws = useWorkspaceId();
  const { can } = useCurrent();
  const q = useQuery({ queryKey: ["integration", ws, id], queryFn: () => integrationsApi.get(id) });
  if (q.isError) return <PageContainer><Panel><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Panel></PageContainer>;
  if (!q.data) return <PageContainer><LoadingBlock rows={5} label="Loading integration" /></PageContainer>;
  const { integration: i, connections } = q.data;
  const available = i.availability === "available";
  return (
    <PageContainer>
      <PageHeader breadcrumbs={[{ label: "Integrations", href: "/integrations" }, { label: i.name }]}
        title={<span className="flex items-center gap-3"><IntegrationLogo id={i.id} name={i.name} size="lg" />{i.name}</span>}
        description={i.description}
        meta={<><IntegrationStatus status={i.status} /><Badge tone="neutral">{i.category}</Badge><Badge tone="neutral">Auth: {i.authType.replace("_", " ")}</Badge></>}
        actions={available && i.configFields.length > 0 && can("connections.manage") && <Button asChild><Link href={`/integrations/${i.id}/connect`}><Plus aria-hidden /> Add connection</Link></Button>}
      />
      {!available && <Alert tone="info" className="mb-5" title="Not available yet">This connector isn't available yet. It's listed so you can plan ahead; it can't be connected or used in workflows today.</Alert>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {available && i.configFields.length > 0 && (
            <Panel aria-labelledby="conn-h">
              <PanelHeader id="conn-h" title="Connections" description="Credential sets in this workspace. Secrets are never displayed after saving." />
              {connections.length === 0 ? (
                <EmptyState compact title="No connections yet" description="Add a connection to use this integration in workflows." action={can("connections.manage") && <Button asChild variant="outline"><Link href={`/integrations/${i.id}/connect`}>Add connection</Link></Button>} />
              ) : (
                <ul className="divide-y divide-border">
                  {connections.map((c) => (
                    <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Link href={`/integrations/connections/${c.id}`} className="font-medium hover:underline">{c.displayName}</Link>
                        <span className="text-sm text-fg-muted">Secret <Mono>{c.secretHint}</Mono> · tested <RelativeTime iso={c.lastTestedAt} /> · used by {c.usedBy.length} workflow{c.usedBy.length === 1 ? "" : "s"}</span>
                        {c.lastError && c.status !== "connected" && <span className="text-sm text-danger-fg dark:text-danger">{c.lastError}</span>}
                      </div>
                      <StatusBadge meta={CONNECTION_STATUS_META[c.status]} />
                      <Button asChild variant="ghost" size="sm"><Link href={`/integrations/connections/${c.id}`}>Manage<span className="sr-only"> {c.displayName}</span><ArrowRight aria-hidden /></Link></Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          <Panel aria-labelledby="act-h">
            <PanelHeader id="act-h" title="Actions" description="Declared by the connector contract: idempotency, retryability, timeout and scopes." />
            {i.actions.length === 0 ? <p className="p-4 text-sm text-fg-muted">{i.id === "int_webhook" ? "Inbound only. Configure endpoints under Webhooks." : i.id === "int_schedule" ? "Trigger only. In a workflow, open the trigger step and choose “On a schedule”." : "No actions yet."}</p> : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Actions table">
                <table className="w-full text-left text-base">
                  <caption className="sr-only">Actions provided by {i.name}</caption>
                  <thead className="bg-surface-sunken text-sm text-fg-muted"><tr><th scope="col" className="px-4 py-2 font-medium">Action</th><th scope="col" className="px-4 py-2 font-medium">Idempotent</th><th scope="col" className="px-4 py-2 font-medium">Retryable</th><th scope="col" className="px-4 py-2 font-medium">Timeout</th><th scope="col" className="px-4 py-2 font-medium">Scopes</th></tr></thead>
                  <tbody>
                    {i.actions.map((a) => (
                      <tr key={a.key} className="border-t border-border align-top">
                        <td className="px-4 py-2.5"><span className="font-medium">{a.name}</span><span className="block font-mono text-xs text-fg-subtle">{a.key}</span><span className="block text-sm text-fg-muted">{a.description}</span></td>
                        <td className="px-4 py-2.5">{a.idempotent ? "Yes" : "No"}</td>
                        <td className="px-4 py-2.5">{a.retryable ? "Yes" : "No"}</td>
                        <td className="px-4 py-2.5 tabular">{a.timeoutSec}s</td>
                        <td className="px-4 py-2.5">{a.scopes.map((s) => <Mono key={s} className="mr-1">{s}</Mono>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
        <Panel aria-labelledby="docs-h" className="h-fit">
          <PanelHeader id="docs-h" title="Notes" />
          <PanelBody>
            {i.docs.length ? <ul className="flex list-disc flex-col gap-2 pl-5 text-base">{i.docs.map((d) => <li key={d}>{d}</li>)}</ul> : <p className="text-sm text-fg-muted">No notes.</p>}
          </PanelBody>
        </Panel>
      </div>
    </PageContainer>
  );
}
