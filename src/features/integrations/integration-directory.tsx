"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, Clock, FilterX } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { SearchInput } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { IntegrationCategory } from "@/lib/domain/types";
import { INTEGRATION_CATEGORIES } from "@/lib/integrations/catalog";
import { integrationsApi } from "@/lib/services";
import type { IntegrationListItem } from "@/lib/services/types";
import { useDebounced } from "@/hooks/use-url-state";
import { IntegrationLogo } from "./integration-logo";
import { useWorkspaceId } from "@/hooks/use-current";

export function IntegrationStatus({ status }: { status: IntegrationListItem["status"] }) {
  if (status === "connected") return <Badge tone="success"><Check className="size-3.5" aria-hidden />Connected</Badge>;
  if (status === "error") return <Badge tone="danger"><AlertTriangle className="size-3.5" aria-hidden />Needs attention</Badge>;
  if (status === "planned") return <Badge tone="neutral"><Clock className="size-3.5" aria-hidden />Planned</Badge>;
  return <Badge tone="neutral">Not connected</Badge>;
}

export function IntegrationDirectory() {
  const ws = useWorkspaceId();
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState<IntegrationCategory | "all">("all");
  const debounced = useDebounced(search, 150);
  const q = useQuery({ queryKey: ["integrations", ws, debounced, category], queryFn: () => integrationsApi.list({ search: debounced, category }) });
  return (
    <PageContainer>
      <PageHeader title="Integrations" description="Built-in connectors and the generic HTTP connector. Credentials are stored in the secret manager; Brightrail keeps only a reference."
        actions={<Button asChild variant="outline"><Link href="/integrations/webhooks">Manage webhooks</Link></Button>} />
      <Tabs value={category} onValueChange={(v) => setCategory(v as IntegrationCategory | "all")}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput label="Search integrations" placeholder="Search by name, category or action" value={search} onValueChange={setSearch} className="lg:w-80" />
          <TabsList variant="pill" aria-label="Integration categories">
            <TabsTrigger value="all">All</TabsTrigger>
            {INTEGRATION_CATEGORIES.map((c) => <TabsTrigger key={c} value={c}>{c}</TabsTrigger>)}
          </TabsList>
      </div>
      <TabsContent value={category} className="pt-0">
      {q.isError ? <Panel><ErrorState error={q.error} onRetry={() => void q.refetch()} title="Couldn't load integrations" /></Panel> : q.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading integrations">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>
      ) : q.data.length === 0 ? (
        <Panel><EmptyState icon={<FilterX />} title="No integrations match" description={search ? `Nothing matches “${search}”.` : "No integrations in this category."} action={<Button variant="outline" onClick={() => { setSearch(""); setCategory("all"); }}>Clear filters</Button>} /></Panel>
      ) : (
        <>
          <p className="sr-only" role="status">{q.data.length} integrations shown</p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {q.data.map((i) => (
              <li key={i.id}>
                <Link href={i.id === "int_webhook" ? "/integrations/webhooks" : i.id === "int_schedule" ? "/workflows" : `/integrations/${i.id}`} className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong">
                  <div className="flex items-start gap-3">
                    <IntegrationLogo id={i.id} name={i.name} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold group-hover:underline">{i.name}</span>
                      <span className="text-sm text-fg-muted">{i.category} · {i.vendor}</span>
                    </div>
                  </div>
                  <p className="flex-1 text-base text-fg-muted">{i.summary}</p>
                  <div className="flex items-center justify-between gap-2">
                    <IntegrationStatus status={i.status} />
                    <span className="flex items-center gap-1 text-sm text-fg-muted">{i.availability === "planned" ? "Coming later" : `${i.connectionCount} ${i.id === "int_webhook" ? "endpoint" : i.id === "int_schedule" ? "scheduled workflow" : "connection"}${i.connectionCount === 1 ? "" : "s"}`}<ArrowRight className="size-4" aria-hidden /></span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
