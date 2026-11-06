"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import * as React from "react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Panel } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApprovalCard } from "@/features/ai/approval-card";
import type { ApprovalStatus } from "@/lib/domain/types";
import { aiApi } from "@/lib/services";
import { useWorkspaceId } from "@/hooks/use-current";

export default function ApprovalsPage() {
  const ws = useWorkspaceId();
  const [status, setStatus] = React.useState<ApprovalStatus | "all">("pending");
  const q = useQuery({ queryKey: ["approvals", ws, status], queryFn: () => aiApi.listApprovals(status) });
  React.useEffect(() => { document.title = "Approvals · FlowForge"; }, []);
  return (
    <PageContainer>
      <PageHeader title="Approvals" description="Consequential recovery actions proposed by the AI assistant or requested by teammates. Nothing runs until an authorized person approves." />
      <Tabs value={status} onValueChange={(v) => setStatus(v as ApprovalStatus | "all")}>
        <TabsList aria-label="Filter approvals by status">
          {(["pending", "approved", "rejected", "expired", "all"] as const).map((s) => <TabsTrigger key={s} value={s} className="capitalize">{s}</TabsTrigger>)}
        </TabsList>
      <TabsContent value={status}>
      <div aria-live="polite">
        {q.isPending ? <LoadingBlock rows={3} label="Loading approvals" /> : q.isError ? <Panel><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Panel> : q.data.length === 0 ? (
          <Panel><EmptyState icon={<ClipboardCheck />} title={status === "pending" ? "Nothing waiting for approval" : `No ${status === "all" ? "" : status} requests`} description="When the assistant proposes a retry, it appears here for review." /></Panel>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">{q.data.map((a) => <li key={a.id}><ApprovalCard approval={a} showRunLink /></li>)}</ul>
        )}
      </div>
      </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
