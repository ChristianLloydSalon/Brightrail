"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { planName } from "@/lib/domain/plans";
import Link from "next/link";
import { Lock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SwitchField } from "@/components/ui/checkbox";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { Field, FormErrorSummary } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import type { WorkspaceSettings as WS } from "@/lib/domain/types";
import { ApiError, errorMessage, workspaceApi } from "@/lib/services";

const TIMEZONES = ["UTC", "Asia/Singapore", "Asia/Manila", "Asia/Tokyo", "Australia/Sydney", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles"];
const LABELS: Record<string, string> = { name: "Workspace name", slug: "Workspace URL", maxAttempts: "Max attempts", initialIntervalSec: "Initial interval", maxIntervalSec: "Max interval" };

export function WorkspaceSettingsView() {
  const ws = useWorkspaceId();
  const { can } = useCurrent();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["workspace", ws], queryFn: () => workspaceApi.get() });
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [s, setS] = React.useState<WS | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [delOpen, setDelOpen] = React.useState(false);
  useOnChange(q.data, (w) => { if (w) { setName(w.name); setSlug(w.slug); setS(structuredClone(w.settings)); } });
  const save = useMutation({ mutationFn: () => workspaceApi.update({ name, slug, settings: s! }), onSuccess: async () => { setErrors({}); await qc.invalidateQueries(); toast.success("Workspace settings saved"); }, onError: (e) => { if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors); else toast.error(errorMessage(e)); } });
  const del = useMutation({ mutationFn: () => workspaceApi.remove(q.data!.name), onSuccess: () => { qc.clear(); toast.success("Workspace deleted"); router.push("/onboarding"); }, onError: (e) => toast.error(errorMessage(e)) });

  if (q.isError) return <PageContainer><Panel><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Panel></PageContainer>;
  if (!q.data || !s) return <PageContainer><LoadingBlock rows={6} label="Loading workspace settings" /></PageContainer>;
  const editable = can("workspace.manage");
  const setRetry = (patch: Partial<WS["defaultRetry"]>) => setS({ ...s, defaultRetry: { ...s.defaultRetry, ...patch } });
  const validate = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = "Use at least 2 characters.";
    if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug)) e.slug = "Use 3–48 lowercase letters, numbers and hyphens.";
    if (!(s.defaultRetry.maxAttempts >= 1 && s.defaultRetry.maxAttempts <= 10)) e.maxAttempts = "Use between 1 and 10.";
    if (!(s.defaultRetry.initialIntervalSec >= 1 && s.defaultRetry.initialIntervalSec <= 300)) e.initialIntervalSec = "Use between 1 and 300 seconds.";
    if (!(s.defaultRetry.maxIntervalSec >= s.defaultRetry.initialIntervalSec)) e.maxIntervalSec = "Must be at least the initial interval.";
    return e;
  };
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title="Workspace settings" description="Configuration that applies to every workflow and member in this workspace." />
      {!editable && <Alert tone="info" className="mb-5">You can view these settings. Only owners and admins can change them.</Alert>}
      <form noValidate onSubmit={(e) => { e.preventDefault(); const er = validate(); setErrors(er); if (!Object.keys(er).length) save.mutate(); }} className="flex flex-col gap-5">
        <FormErrorSummary errors={Object.entries(errors).map(([k, m]) => ({ id: `ws-${k}`, message: `${LABELS[k] ?? k}: ${m}` }))} />
        <fieldset disabled={!editable} className="flex flex-col gap-5">
          <Panel aria-labelledby="gen-h"><PanelHeader id="gen-h" title="General" />
            <PanelBody className="grid gap-4 sm:grid-cols-2">
              <Field id="ws-name" label="Workspace name" required error={errors.name}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <Field id="ws-slug" label="Workspace URL" required error={errors.slug} description={`flowforge.app/${slug || "…"}`}>{(p) => <Input {...p} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className="font-mono" />}</Field>
              <Field label="Time zone" description="Used for schedules and reports.">{(p) => <Select {...p} value={s.timezone} onValueChange={(v) => setS({ ...s, timezone: v })} options={[...new Set([s.timezone, ...TIMEZONES])].map((t) => ({ value: t, label: t.replace("_", " ") }))} />}</Field>
              <Field label="Plan" description={<Link href="/settings/plan" className="text-link hover:underline">See usage or change plan</Link>}>{(p) => <Input {...p} readOnly value={`${planName(q.data.plan)} · ${q.data.quotas.executionsPerMonth.toLocaleString()} runs/month`} />}</Field>
            </PanelBody>
          </Panel>
          <Panel aria-labelledby="ret-h"><PanelHeader id="ret-h" title="Default retry policy" description="Applied to new steps. Each step can override it. Backoff is exponential." />
            <PanelBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field id="ws-maxAttempts" label="Max attempts" error={errors.maxAttempts}>{(p) => <Input {...p} type="number" min={1} max={10} value={s.defaultRetry.maxAttempts} onChange={(e) => setRetry({ maxAttempts: Number(e.target.value) })} />}</Field>
              <Field id="ws-initialIntervalSec" label="Initial interval (s)" error={errors.initialIntervalSec}>{(p) => <Input {...p} type="number" min={1} value={s.defaultRetry.initialIntervalSec} onChange={(e) => setRetry({ initialIntervalSec: Number(e.target.value) })} />}</Field>
              <Field label="Backoff coefficient">{(p) => <Select {...p} value={String(s.defaultRetry.backoffCoefficient)} onValueChange={(v) => setRetry({ backoffCoefficient: Number(v) })} options={["1.5", "2", "3"].map((v) => ({ value: v, label: `×${v}` }))} />}</Field>
              <Field id="ws-maxIntervalSec" label="Max interval (s)" error={errors.maxIntervalSec}>{(p) => <Input {...p} type="number" min={1} value={s.defaultRetry.maxIntervalSec} onChange={(e) => setRetry({ maxIntervalSec: Number(e.target.value) })} />}</Field>
            </PanelBody>
          </Panel>
          <Panel aria-labelledby="data-h"><PanelHeader id="data-h" title="Data and privacy" />
            <PanelBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Run history retention" description="Runs, step payloads and logs older than this are deleted.">{(p) => <Select {...p} value={String(s.retentionDays)} onValueChange={(v) => setS({ ...s, retentionDays: Number(v) })} options={[7, 14, 30, 90].map((d) => ({ value: String(d), label: `${d} days` }))} />}</Field>
              <Field label="Payload storage">{(p) => <Select {...p} value={s.payloadStorage} onValueChange={(v) => setS({ ...s, payloadStorage: v })} options={[{ value: "redacted", label: "Store redacted payloads", description: "Secrets removed, personal data masked" }, { value: "minimal", label: "Store minimal metadata only", description: "No input or output bodies" }]} />}</Field>
            </PanelBody>
          </Panel>
          <Panel aria-labelledby="ai-h"><PanelHeader id="ai-h" title="AI exception assistant" />
            <PanelBody className="flex flex-col divide-y divide-border">
              <SwitchField id="ws-ai" label="Enable the AI assistant" description="Members can request failure analysis. Only sanitized run data is sent to the model; customer data isn't used for training." checked={s.aiAssistantEnabled} onCheckedChange={(v) => setS({ ...s, aiAssistantEnabled: v })} />
              <SwitchField id="ws-ai-approval" label="Require approval for AI-proposed retries" checked disabled onCheckedChange={() => {}} locked={<span className="inline-flex items-center gap-1"><Lock className="size-3.5" aria-hidden />Always on. Consequential actions can't be automated.</span>} />
              <div className="pt-3"><Field label="Approval requests expire after">{(p) => <Select {...p} value={String(s.approvalExpiryHours)} onValueChange={(v) => setS({ ...s, approvalExpiryHours: Number(v) })} options={[4, 12, 24, 48, 72].map((h) => ({ value: String(h), label: `${h} hours` }))} className="sm:w-60" />}</Field></div>
            </PanelBody>
          </Panel>
        </fieldset>
        {editable && <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save changes</Button></div>}
      </form>
      {can("workspace.delete") && (
        <Panel aria-labelledby="dz-h" className="mt-8 border-danger-border">
          <PanelHeader id="dz-h" title="Danger zone" />
          <PanelBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-medium">Delete this workspace</p><p className="text-sm text-fg-muted">Permanently deletes all workflows, runs, connections, secrets and members. This can't be undone.</p></div>
            <Button variant="destructive" onClick={() => setDelOpen(true)}><Trash2 aria-hidden /> Delete workspace</Button>
          </PanelBody>
        </Panel>
      )}
      <ConfirmDialog open={delOpen} onOpenChange={setDelOpen} destructive title="Delete workspace?" confirmLabel="Delete workspace permanently" confirmText={q.data.name} loading={del.isPending} onConfirm={() => del.mutate()}
        description="Every workflow, run, credential and audit entry in this workspace will be deleted. Members lose access immediately." />
    </PageContainer>
  );
}
