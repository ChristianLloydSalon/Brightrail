"use client";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Panel } from "@/components/ui/card";
import { useUrlState } from "@/hooks/use-url-state";
import { RUN_FILTER_DEFAULTS, RunsTable } from "./runs-table";

export function ExecutionsPage() {
  const [state, set] = useUrlState({ ...RUN_FILTER_DEFAULTS });
  return (
    <PageContainer wide>
      <PageHeader title="Executions" description="Every run, the version it was pinned to, and what happened at each step. Rows highlighted in red have an open exception." />
      <Panel><RunsTable state={state} set={set} /></Panel>
    </PageContainer>
  );
}
