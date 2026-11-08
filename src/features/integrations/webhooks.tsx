"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { KeyRound, Plus, Send, Webhook } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { OneTimeSecretDialog } from "@/components/shared/one-time-secret";
import { RelativeTime } from "@/components/shared/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup, SwitchField } from "@/components/ui/checkbox";
import { CodeBlock, CopyButton } from "@/components/ui/code";
import { DescriptionList, Mono, Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog, Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert, EmptyState, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { Field, Fieldset } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import type { WebhookDelivery } from "@/lib/domain/types";
import { ApiError, errorMessage, webhooksApi, workflowsApi } from "@/lib/services";
import type { WebhookListItem } from "@/lib/services/types";

const DELIVERY_META: Record<WebhookDelivery["status"], { label: string; tone: "success" | "neutral" | "danger" | "warning" }> = {
  accepted: { label: "Accepted", tone: "success" }, duplicate: { label: "Duplicate (idempotent)", tone: "neutral" }, rejected_signature: { label: "Bad signature", tone: "danger" },
  rejected_replay: { label: "Outside replay window", tone: "danger" }, rejected_size: { label: "Body too large", tone: "warning" }, rejected_rate: { label: "Rate limited", tone: "warning" },
  not_started: { label: "Not started (workflow paused or quota reached)", tone: "warning" },
};
const REPLAY_OPTIONS = [{ value: "60", label: "1 minute" }, { value: "300", label: "5 minutes (recommended)" }, { value: "600", label: "10 minutes" }, { value: "900", label: "15 minutes" }];

function CreateWebhookDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (secret: string, hint: string, id: string, link?: string) => void }) {
  const ws = useWorkspaceId();
  const wfs = useQuery({ queryKey: ["workflows", ws, "webhook-candidates"], queryFn: () => workflowsApi.list({ pageSize: 200, sort: "name", dir: "asc" }), enabled: open });
  const existing = useQuery({ queryKey: ["webhooks", ws], queryFn: () => webhooksApi.list(), enabled: open });
  const [v, setV] = React.useState({ name: "", workflowId: "", replay: "300", verification: "url_key" as "hmac" | "url_key" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const qc = useQueryClient();
  useOnChange(open, (o) => { if (!o) { setV({ name: "", workflowId: "", replay: "300", verification: "url_key" }); setErrors({}); } });
  const m = useMutation({
    mutationFn: () => webhooksApi.create({ name: v.name, workflowId: v.workflowId, replayWindowSec: Number(v.replay), maxBodyKb: 256, rateLimitPerMin: 120, verification: v.verification }),
    onSuccess: async (r) => { await qc.invalidateQueries(); onOpenChange(false); onCreated(r.secret.value, r.secret.hint, r.endpoint.id, r.secret.link); },
    onError: (e) => { if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors); },
  });
  const used = new Set((existing.data ?? []).map((w) => w.workflowId));
  const candidates = (wfs.data?.items ?? []).filter((w) => w.triggerType === "webhook" && w.status !== "archived");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Create webhook endpoint" description="Each endpoint starts one workflow and has its own secret." />
        <form noValidate onSubmit={(e) => { e.preventDefault(); const er: Record<string, string> = {}; if (v.name.trim().length < 3) er.name = "Use at least 3 characters."; if (!v.workflowId) er.workflowId = "Choose a workflow."; setErrors(er); if (!Object.keys(er).length) m.mutate(); }}>
          <DialogBody className="flex flex-col gap-4">
            {m.isError && !(m.error instanceof ApiError && m.error.fieldErrors) && <Alert tone="danger" role="alert">{errorMessage(m.error)}</Alert>}
            <Field label="Name" required error={errors.name}>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Storefront orders" />}</Field>
            <Field label="Workflow" required error={errors.workflowId} description="Only workflows with a webhook trigger are listed.">
              {(p) => <Select {...p} value={v.workflowId || undefined} onValueChange={(x) => setV({ ...v, workflowId: x })} loading={wfs.isPending} error={wfs.isError ? "Couldn't load workflows" : null} emptyMessage="No workflows with a webhook trigger"
                options={candidates.map((w) => ({ value: w.id, label: w.name, description: used.has(w.id) ? "Already has an endpoint" : w.status === "active" ? "Active" : w.status, disabled: used.has(w.id) }))} placeholder="Choose a workflow" />}
            </Field>
            <Fieldset legend="Who sends the events?">
              <RadioGroup value={v.verification} onValueChange={(x) => setV({ ...v, verification: x as "hmac" | "url_key" })}>
                <RadioCard id="wh-v-key" value="url_key" label="A form tool or no-code app" description="Tally, Typeform, Jotform, Zapier, Make, n8n… You get a secret link to paste into its webhook setting. No code." />
                <RadioCard id="wh-v-hmac" value="hmac" label="My own code or a server" description="Each request is signed with HMAC-SHA256 and time-stamped. Most secure; needs a few lines of code." />
              </RadioGroup>
            </Fieldset>
            {v.verification === "hmac" && <Field label="Replay window" description="Deliveries with an older timestamp are rejected.">{(p) => <Select {...p} value={v.replay} onValueChange={(x) => setV({ ...v, replay: x })} options={REPLAY_OPTIONS} />}</Field>}
          </DialogBody>
          <DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button type="submit" loading={m.isPending}>Create endpoint</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WebhookList() {
  const ws = useWorkspaceId();
  const { can } = useCurrent();
  const router = useRouter();
  const params = useSearchParams();
  const [createOpen, setCreateOpen] = React.useState(params.get("new") === "1");
  const [secret, setSecret] = React.useState<{ value: string; hint: string; id: string; link?: string } | null>(null);
  const q = useQuery({ queryKey: ["webhooks", ws], queryFn: () => webhooksApi.list() });
  const columns: Column<WebhookListItem>[] = [
    { id: "name", header: "Endpoint", cell: (w) => <div className="flex flex-col"><Link href={`/integrations/webhooks/${w.id}`} className="font-medium hover:underline">{w.name}</Link><span className="truncate font-mono text-xs text-fg-subtle">{w.url}</span></div> },
    { id: "wf", header: "Workflow", cell: (w) => <Link href={`/workflows/${w.workflowId}`} className="text-sm hover:underline">{w.workflowName}</Link> },
    { id: "status", header: "Status", cell: (w) => <Badge tone={w.status === "active" ? "success" : "neutral"}>{w.status === "active" ? "Active" : "Disabled"}</Badge> },
    { id: "last", header: "Last delivery", hideBelow: "lg", cell: (w) => w.lastDelivery ? <span className="flex flex-col text-sm"><RelativeTime iso={w.lastDelivery.receivedAt} /><span className="text-fg-muted">{DELIVERY_META[w.lastDelivery.status].label}</span></span> : <span className="text-sm text-fg-subtle">None</span> },
    { id: "24h", header: "Last 24h", align: "right", cell: (w) => <span className="text-sm tabular">{w.deliveries24h}{w.rejected24h ? <span className="text-danger-fg"> ({w.rejected24h} rejected)</span> : ""}</span> },
  ];
  return (
    <PageContainer>
      <PageHeader breadcrumbs={[{ label: "Integrations", href: "/integrations" }, { label: "Webhooks" }]} title="Webhooks"
        description="Signed inbound endpoints. Each delivery is verified (HMAC-SHA256 over timestamp and raw body), checked against the replay window, and deduplicated before a run starts."
        actions={can("connections.manage") && <Button onClick={() => setCreateOpen(true)}><Plus aria-hidden /> Create endpoint</Button>} />
      <Panel>
        <DataTable caption="Webhook endpoints" columns={columns} rows={q.data} getRowId={(w) => w.id} isLoading={q.isPending} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          empty={<EmptyState icon={<Webhook />} title="No webhook endpoints" description="Create an endpoint for a workflow with a webhook trigger." action={can("connections.manage") && <Button onClick={() => setCreateOpen(true)}>Create endpoint</Button>} />}
          mobileCard={(w) => <Link href={`/integrations/webhooks/${w.id}`} className="flex flex-col gap-1"><span className="flex justify-between gap-2 font-medium">{w.name}<Badge tone={w.status === "active" ? "success" : "neutral"}>{w.status === "active" ? "Active" : "Disabled"}</Badge></span><span className="text-sm text-fg-muted">{w.workflowName} · {w.deliveries24h} deliveries in 24h</span></Link>} />
      </Panel>
      <CreateWebhookDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(value, hint, id, link) => setSecret({ value, hint, id, link })} />
      <OneTimeSecretDialog open={!!secret} title={secret?.link ? "Your secret webhook link" : "Signing secret created"} secret={secret?.link ?? secret?.value ?? null} hint={secret?.hint} note={secret?.link ? "Paste this whole link into your form tool's webhook setting (method POST). It contains the secret key, so keep it private." : undefined} onClose={() => { const id = secret?.id; setSecret(null); if (id) router.push(`/integrations/webhooks/${id}`); }} />
    </PageContainer>
  );
}

const VERIFY_SNIPPET = `// Verify a Brightrail delivery (Node.js)
const ts = req.headers["x-brightrail-timestamp"];
const sig = req.headers["x-brightrail-signature"]; // "sha256=<hex>"
if (Math.abs(Date.now() / 1000 - Number(ts)) > REPLAY_WINDOW) reject();
const expected = "sha256=" + crypto
  .createHmac("sha256", process.env.BRIGHTRAIL_SIGNING_SECRET)
  .update(ts + "." + rawBody)
  .digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) reject();`;

export function WebhookDetail({ id }: { id: string }) {
  const router = useRouter();
  const ws = useWorkspaceId();
  const { can } = useCurrent();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["webhook", ws, id], queryFn: () => webhooksApi.get(id) });
  const [form, setForm] = React.useState({ name: "", status: "active" as "active" | "disabled", replay: "300", maxBodyKb: 256, rate: 120, verification: "hmac" as "hmac" | "url_key", headerKeyOnly: false });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [secret, setSecret] = React.useState<{ value: string; hint: string; link?: string } | null>(null);
  const [modeConfirm, setModeConfirm] = React.useState(false);
  // Copy saved settings into the form whenever they change on the server.
  useOnChange(q.data?.endpoint, (e) => { if (e) setForm({ name: e.name, status: e.status, replay: String(e.replayWindowSec), maxBodyKb: e.maxBodyKb, rate: e.rateLimitPerMin, verification: e.verification, headerKeyOnly: e.headerKeyOnly }); });
  const save = useMutation({ mutationFn: () => webhooksApi.update(id, { name: form.name, status: form.status, replayWindowSec: Number(form.replay), maxBodyKb: form.maxBodyKb, rateLimitPerMin: form.rate, verification: form.verification, headerKeyOnly: form.headerKeyOnly }), onSuccess: async (r) => { await qc.invalidateQueries(); setModeConfirm(false); if (r.secret) setSecret(r.secret); toast.success("Webhook settings saved"); }, onError: (e) => { if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors); else toast.error(errorMessage(e)); } });
  const rotate = useMutation({ mutationFn: () => webhooksApi.rotateSecret(id), onSuccess: async (s) => { await qc.invalidateQueries(); setRotateOpen(false); setSecret(s); } });
  const test = useMutation({ mutationFn: async () => webhooksApi.sendTestEvent(id, await workflowsApi.sampleInput(q.data!.endpoint.workflowId)), onSuccess: async (d) => { await qc.invalidateQueries(); if (d.runId) toast.success("Test event accepted", { description: `Run ${d.runId} started.`, action: { label: "Open run", onClick: () => router.push(`/executions/${d.runId}`) } }); else toast.error("Test event rejected", { description: `HTTP ${d.httpStatus}. ${d.httpStatus === 409 ? "Publish the workflow and make sure it is active." : "The endpoint is disabled."}` }); }, onError: (e) => toast.error(errorMessage(e)) });

  if (q.isError) return <PageContainer><Panel><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Panel></PageContainer>;
  if (!q.data) return <PageContainer><LoadingBlock rows={5} label="Loading webhook" /></PageContainer>;
  const { endpoint: e, deliveries } = q.data;
  const manage = can("connections.manage");
  const dCols: Column<WebhookDelivery>[] = [
    { id: "t", header: "Received", cell: (d) => <RelativeTime iso={d.receivedAt} className="text-sm" /> },
    { id: "s", header: "Result", cell: (d) => <Badge tone={DELIVERY_META[d.status].tone}>{DELIVERY_META[d.status].label}</Badge> },
    { id: "h", header: "HTTP", cell: (d) => <span className="font-mono text-sm">{d.httpStatus}</span> },
    { id: "e", header: "Event ID", hideBelow: "lg", cell: (d) => <Mono>{d.eventId}</Mono> },
    { id: "r", header: "Run", cell: (d) => d.runId ? <Link href={`/executions/${d.runId}`} className="font-mono text-sm text-link hover:underline">{d.runId}</Link> : <span className="text-sm text-fg-subtle">—</span> },
  ];
  return (
    <PageContainer>
      <PageHeader breadcrumbs={[{ label: "Integrations", href: "/integrations" }, { label: "Webhooks", href: "/integrations/webhooks" }, { label: e.name }]} title={e.name}
        meta={<><Badge tone={e.status === "active" ? "success" : "neutral"}>{e.status === "active" ? "Active" : "Disabled"}</Badge><Link href={`/workflows/${e.workflowId}`} className="text-sm text-link hover:underline">Starts {e.workflowName}</Link></>}
        actions={manage && <><Button variant="outline" onClick={() => test.mutate()} loading={test.isPending}><Send aria-hidden /> Send test event</Button><Button variant="outline" onClick={() => setRotateOpen(true)}><KeyRound aria-hidden /> Rotate secret</Button></>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Panel aria-labelledby="ep-h">
            <PanelHeader id="ep-h" title="Endpoint" />
            <PanelBody className="flex flex-col gap-4">
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface-sunken p-2"><code className="min-w-0 flex-1 truncate font-mono text-sm">POST {e.url}</code><CopyButton value={e.url} label="Copy URL" /></div>
              <DescriptionList columns={3} items={[
                { term: e.verification === "url_key" ? "Secret key (in the link)" : "Signing secret", value: <><Mono>{e.secretHint}</Mono><span className="block text-sm text-fg-muted">Shown only once, at creation or rotation</span></> },
                { term: "Last rotated", value: e.rotatedAt ? <RelativeTime iso={e.rotatedAt} /> : "Never" },
                { term: "Created", value: <RelativeTime iso={e.createdAt} /> },
              ]} />
            </PanelBody>
          </Panel>
          <Panel aria-labelledby="dl-h">
            <PanelHeader id="dl-h" title="Recent deliveries" description="Rejected deliveries never start a run." />
            <DataTable caption="Recent webhook deliveries" columns={dCols} rows={deliveries} getRowId={(d) => d.id} empty={<EmptyState compact title="No deliveries yet" description="Send a test event to see one here." />}
              mobileCard={(d) => <div className="flex flex-col gap-1"><span className="flex justify-between"><RelativeTime iso={d.receivedAt} /><Badge tone={DELIVERY_META[d.status].tone}>{DELIVERY_META[d.status].label}</Badge></span>{d.runId && <Link href={`/executions/${d.runId}`} className="font-mono text-sm text-link">{d.runId}</Link>}</div>} />
          </Panel>
          {e.verification === "url_key" ? (
            <Panel aria-labelledby="vf-h"><PanelHeader id="vf-h" title="Connecting a form tool" description="No code needed" />
              <PanelBody className="flex flex-col gap-2 text-sm">
                <ol className="ml-5 list-decimal space-y-1">
                  <li>In your form tool, find its <strong>Webhook</strong> setting (Tally: Integrations → Webhooks; Typeform: Connect → Webhooks; Zapier/Make: “Webhooks by…” → POST).</li>
                  <li>Paste the <strong>secret link</strong> you got when this endpoint was created. Lost it? <strong>Rotate secret</strong> to get a new one.</li>
                  <li>Submit a test entry. It appears under Recent deliveries and starts the workflow. Form fields are available as <code>{"{{field_name}}"}</code>.</li>
                </ol>
                <p className="text-fg-muted">JSON and regular form posts both work. Anyone with the link can start this workflow, so keep it private like a password.</p>
              </PanelBody>
            </Panel>
          ) : (
            <Panel aria-labelledby="vf-h"><PanelHeader id="vf-h" title="Verifying signatures" description="What senders and receivers must agree on" /><PanelBody><CodeBlock code={VERIFY_SNIPPET} label="Example" /></PanelBody></Panel>
          )}
        </div>
        <Panel aria-labelledby="set-h" className="h-fit">
          <PanelHeader id="set-h" title="Settings" />
          <form noValidate onSubmit={(ev) => { ev.preventDefault(); const er: Record<string, string> = {}; if (form.name.trim().length < 3) er.name = "Use at least 3 characters."; if (form.maxBodyKb < 1 || form.maxBodyKb > 1024) er.maxBodyKb = "Use 1–1024 KB."; if (form.rate < 1 || form.rate > 6000) er.rate = "Use 1–6000 per minute."; setErrors(er); if (Object.keys(er).length) return; if (form.verification !== e.verification) setModeConfirm(true); else save.mutate(); }}>
            <fieldset disabled={!manage}>
              <PanelBody className="flex flex-col gap-4">
                <Field label="Name" required error={errors.name}>{(p) => <Input {...p} value={form.name} onChange={(x) => setForm({ ...form, name: x.target.value })} />}</Field>
                <SwitchField id="wh-status" label="Accept deliveries" description="Disabled endpoints reject every delivery with 410 Gone." checked={form.status === "active"} onCheckedChange={(c) => setForm({ ...form, status: c ? "active" : "disabled" })} />
                <Field label="Sender proves it's genuine with" description={form.verification !== e.verification ? "Saving issues a new secret; the current one stops working." : undefined}>
                  {(p) => <Select {...p} value={form.verification} onValueChange={(x) => setForm({ ...form, verification: x as "hmac" | "url_key" })} options={[{ value: "url_key", label: "Secret link (form tools, no-code apps)" }, { value: "hmac", label: "Signed requests (your own code)" }]} />}
                </Field>
                {form.verification === "url_key" && <SwitchField id="wh-header-only" label="Only accept the key in a header" description="Reject keys sent in the link (?key=…), which can end up in logs. Turn this on if your sender can set the X-Brightrail-Key header." checked={form.headerKeyOnly} onCheckedChange={(c) => setForm({ ...form, headerKeyOnly: c })} />}
                <Field label="Replay window" error={errors.replayWindowSec}>{(p) => <Select {...p} value={form.replay} onValueChange={(x) => setForm({ ...form, replay: x })} options={REPLAY_OPTIONS} />}</Field>
                <Field label="Max body size (KB)" error={errors.maxBodyKb}>{(p) => <Input {...p} type="number" min={1} max={1024} value={form.maxBodyKb} onChange={(x) => setForm({ ...form, maxBodyKb: Number(x.target.value) })} />}</Field>
                <Field label="Rate limit (per minute)" error={errors.rate}>{(p) => <Input {...p} type="number" min={1} max={6000} value={form.rate} onChange={(x) => setForm({ ...form, rate: Number(x.target.value) })} />}</Field>
              </PanelBody>
              {manage && <div className="flex justify-end border-t border-border px-4 py-3"><Button type="submit" loading={save.isPending}>Save settings</Button></div>}
            </fieldset>
          </form>
        </Panel>
      </div>
      <ConfirmDialog open={rotateOpen} onOpenChange={setRotateOpen} destructive title="Rotate signing secret?" confirmLabel="Rotate secret" loading={rotate.isPending} onConfirm={() => rotate.mutate()}
        description={e.verification === "url_key" ? "The current link stops working immediately. Paste the new link into your form tool afterwards." : "The current secret stops working immediately. Senders will get 401 until they use the new secret."} />
      <OneTimeSecretDialog open={!!secret} title={secret?.link ? "Your new secret webhook link" : "New signing secret"} secret={secret?.link ?? secret?.value ?? null} hint={secret?.hint} note={secret?.link ? "Paste this whole link into your form tool's webhook setting (method POST). It contains the secret key, so keep it private." : undefined} onClose={() => setSecret(null)} />
      <ConfirmDialog open={modeConfirm} onOpenChange={setModeConfirm} destructive title="Change how senders are verified?" confirmLabel="Change and issue new secret" loading={save.isPending} onConfirm={() => save.mutate()}
        description="Senders using the current secret or link will be rejected until you give them the new one." />
    </PageContainer>
  );
}
