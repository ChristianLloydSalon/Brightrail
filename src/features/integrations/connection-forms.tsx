"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { Ban, CheckCircle2, KeyRound, PlugZap, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { RelativeTime } from "@/components/shared/time";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DescriptionList, Mono, Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, PasswordInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import { CONNECTION_STATUS_META } from "@/lib/domain/status";
import type { ConfigField, Integration } from "@/lib/domain/types";
import { checkOutboundUrl } from "@/lib/domain/url-safety";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { ApiError, errorMessage, integrationsApi } from "@/lib/services";

function ConfigFields({ integration, values, onChange, errors, includeSecret, secret, onSecret }: { integration: Integration; values: Record<string, string>; onChange: (v: Record<string, string>) => void; errors: Record<string, string>; includeSecret: boolean; secret?: string; onSecret?: (s: string) => void }) {
  return (
    <>
      {integration.configFields.map((f: ConfigField) => f.type === "secret" ? (includeSecret && (
        <Field key={f.key} label={f.label} required error={errors.secret} description={f.help}>
          {(p) => <PasswordInput {...p} value={secret} onChange={(e) => onSecret?.(e.target.value)} autoComplete="off" placeholder={f.placeholder} spellCheck={false} />}
        </Field>
      )) : f.type === "select" ? (
        <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]} description={f.help}>
          {(p) => <Select {...p} value={values[f.key]} onValueChange={(v) => onChange({ ...values, [f.key]: v })} placeholder={`Choose ${f.label.toLowerCase()}`} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />}
        </Field>
      ) : (
        <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]} description={f.help}>
          {(p) => <Input {...p} value={values[f.key] ?? ""} onChange={(e) => onChange({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} inputMode={f.type === "url" ? "url" : undefined} className={f.type === "url" ? "font-mono text-sm" : undefined} />}
        </Field>
      ))}
    </>
  );
}

function validate(integration: Integration, name: string, values: Record<string, string>, secret: string | null) {
  const e: Record<string, string> = {};
  if (name.trim().length < 3) e.displayName = "Use at least 3 characters.";
  for (const f of integration.configFields) {
    if (f.type === "secret") continue;
    if (f.required && !values[f.key]?.trim()) e[f.key] = `${f.label} is required.`;
    else if (f.type === "url" && values[f.key]) { const c = checkOutboundUrl(values[f.key]!); if (!c.ok) e[f.key] = c.reason; }
  }
  if (secret !== null && !secret.trim()) e.secret = "Enter the credential.";
  return e;
}

/** INT-03 (new): create a connection with a test before saving. */
export function NewConnectionForm({ integrationId }: { integrationId: string }) {
  const integration = INTEGRATIONS.find((i) => i.id === integrationId);
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = React.useState(integration ? `${integration.name} (production)` : "");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [secret, setSecret] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const test = useMutation({ mutationFn: () => integrationsApi.testDraft(integrationId, values, secret) });
  const save = useMutation({
    mutationFn: () => integrationsApi.createConnection({ integrationId, displayName: name, config: values, secret }),
    onSuccess: async (c) => { await qc.invalidateQueries(); setSecret(""); toast.success("Connection saved", { description: c.status === "connected" ? "Connection test passed." : "Saved, but the connection test failed. Fix it before using it." }); router.push(`/integrations/connections/${c.id}`); },
    onError: (e) => { if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors); },
  });
  if (!integration || integration.availability !== "available" || integration.configFields.length === 0)
    return <PageContainer><Panel><ErrorState title="This integration can't be connected" error="It isn't available or doesn't use stored credentials." /></Panel></PageContainer>;
  const run = (fn: () => void) => { const e = validate(integration, name, values, secret); setErrors(e); if (!Object.keys(e).length) fn(); };
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader breadcrumbs={[{ label: "Integrations", href: "/integrations" }, { label: integration.name, href: `/integrations/${integration.id}` }, { label: "New connection" }]} title={`Connect ${integration.name}`} description="The credential goes straight to the secret manager. After saving you'll only see a short hint, never the value." />
      <Panel>
        <form noValidate onSubmit={(e) => { e.preventDefault(); run(() => save.mutate()); }}>
          <PanelBody className="flex flex-col gap-4">
            {save.isError && !(save.error instanceof ApiError && save.error.fieldErrors) && <Alert tone="danger" role="alert">{errorMessage(save.error)}</Alert>}
            <Field label="Connection name" required error={errors.displayName} description="How this credential appears in the step configuration.">
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <ConfigFields integration={integration} values={values} onChange={setValues} errors={errors} includeSecret secret={secret} onSecret={setSecret} />
            <div role="status" aria-live="polite">
              {test.isSuccess && (test.data.ok ? <Alert tone="success" title="Connection test passed">{test.data.message}</Alert> : <Alert tone="danger" title="Connection test failed">{test.data.message}</Alert>)}
              {test.isError && <Alert tone="danger">{errorMessage(test.error)}</Alert>}
            </div>
            <p className="flex items-start gap-2 text-sm text-fg-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />Only workers that execute steps can decrypt this secret. It's excluded from logs, run payloads and AI context.</p>
          </PanelBody>
          <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-sunken px-4 py-3 sm:flex-row sm:justify-end">
            <Button asChild variant="ghost"><Link href={`/integrations/${integration.id}`}>Cancel</Link></Button>
            <Button variant="outline" onClick={() => run(() => test.mutate())} loading={test.isPending} loadingText="Testing…"><PlugZap aria-hidden /> Test connection</Button>
            <Button type="submit" loading={save.isPending} loadingText="Saving…">Save connection</Button>
          </div>
        </form>
      </Panel>
    </PageContainer>
  );
}

/** INT-03 (manage): edit settings, test, rotate and revoke. */
export function ManageConnection({ connectionId }: { connectionId: string }) {
  const ws = useWorkspaceId();
  const { can } = useCurrent();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["connection", ws, connectionId], queryFn: () => integrationsApi.getConnection(connectionId) });
  const [name, setName] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [revokeOpen, setRevokeOpen] = React.useState(false);
  const [newSecret, setNewSecret] = React.useState("");
  const [secretErr, setSecretErr] = React.useState<string | null>(null);
  useOnChange(q.data, (c) => { if (c) { setName(c.displayName); setValues(c.config); } });

  const done = (msg: string) => async () => { await qc.invalidateQueries(); toast.success(msg); };
  const update = useMutation({ mutationFn: () => integrationsApi.updateConnection(connectionId, { displayName: name, config: values }), onSuccess: done("Connection updated. Run a test to confirm it still works."), onError: (e) => { if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors); else toast.error(errorMessage(e)); } });
  const test = useMutation({ mutationFn: () => integrationsApi.testConnection(connectionId), onSuccess: async (r) => { await qc.invalidateQueries(); if (r.ok) toast.success("Connection test passed"); else toast.error("Connection test failed", { description: r.message }); }, onError: (e) => toast.error(errorMessage(e)) });
  const rotate = useMutation({ mutationFn: () => integrationsApi.rotateConnection(connectionId, newSecret), onSuccess: (c) => { setRotateOpen(false); setNewSecret(""); return done(c.status === "connected" ? "Credential rotated and verified" : "Credential rotated, but the test failed")(); }, onError: (e) => setSecretErr(errorMessage(e)) });
  const revoke = useMutation({ mutationFn: () => integrationsApi.revokeConnection(connectionId), onSuccess: () => { setRevokeOpen(false); return done("Connection revoked. Steps using it will fail until reconnected.")(); } });

  if (q.isError) return <PageContainer><Panel><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Panel></PageContainer>;
  if (!q.data) return <PageContainer><LoadingBlock rows={5} label="Loading connection" /></PageContainer>;
  const c = q.data;
  const integration = INTEGRATIONS.find((i) => i.id === c.integrationId)!;
  const manage = can("connections.manage") && c.status !== "revoked";
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader breadcrumbs={[{ label: "Integrations", href: "/integrations" }, { label: integration.name, href: `/integrations/${integration.id}` }, { label: c.displayName }]}
        title={c.displayName} meta={<StatusBadge meta={CONNECTION_STATUS_META[c.status]} />}
        actions={c.status !== "revoked" && <>
          {manage && <Button variant="outline" onClick={() => test.mutate()} loading={test.isPending} loadingText="Testing…"><PlugZap aria-hidden /> Test connection</Button>}
          {manage && <Button variant="outline" onClick={() => setRotateOpen(true)}><KeyRound aria-hidden /> Rotate credential</Button>}
          {manage && <Button variant="destructive-outline" onClick={() => setRevokeOpen(true)}><Ban aria-hidden /> Revoke</Button>}
        </>}
      />
      <div className="flex flex-col gap-5">
        {c.status === "error" && <Alert tone="danger" role="alert" title="Connection failing" action={manage && <Button size="sm" variant="outline" onClick={() => setRotateOpen(true)}>Rotate credential</Button>}>{c.lastError}</Alert>}
        {c.status === "revoked" && <Alert tone="info" title="Revoked">{c.lastError} Create a new connection to restore access.</Alert>}
        {c.integrationId === "int_sheets" && c.config.serviceAccountEmail && c.status !== "revoked" && (
          <Alert tone="info" title="Share your spreadsheet with this account">
            In Google Sheets, click <strong>Share</strong> and add <Mono>{c.config.serviceAccountEmail}</Mono> as an <strong>Editor</strong>. Then run <em>Test connection</em>.
          </Alert>
        )}
        <Panel aria-labelledby="sec-h">
          <PanelHeader id="sec-h" title="Credential" />
          <PanelBody>
            <DescriptionList columns={3} items={[
              { term: "Stored secret", value: <><Mono>{c.secretHint}</Mono><span className="block text-sm text-fg-muted">Value is never shown</span></> },
              { term: "Secret reference", value: <Mono>{c.secretRef}</Mono> },
              { term: "Last rotated", value: c.rotatedAt ? <RelativeTime iso={c.rotatedAt} /> : "Never" },
              { term: "Last tested", value: <span className="inline-flex items-center gap-1">{c.status === "connected" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <XCircle className="size-4 text-danger" aria-hidden />}<RelativeTime iso={c.lastTestedAt} /></span> },
              { term: "Created", value: <RelativeTime iso={c.createdAt} /> },
              { term: "Connection ID", value: <Mono>{c.id}</Mono> },
            ]} />
          </PanelBody>
        </Panel>
        <Panel aria-labelledby="cfg-h">
          <PanelHeader id="cfg-h" title="Settings" description="Non-secret configuration. Changes mark the connection as untested." />
          <form noValidate onSubmit={(e) => { e.preventDefault(); const er = validate(integration, name, values, null); setErrors(er); if (!Object.keys(er).length) update.mutate(); }}>
            <fieldset disabled={!manage}>
              <PanelBody className="flex flex-col gap-4">
                <Field label="Connection name" required error={errors.displayName}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
                <ConfigFields integration={integration} values={values} onChange={setValues} errors={errors} includeSecret={false} />
              </PanelBody>
              {manage && <div className="flex justify-end border-t border-border px-4 py-3"><Button type="submit" loading={update.isPending}>Save settings</Button></div>}
            </fieldset>
          </form>
        </Panel>
      </div>
      <Dialog open={rotateOpen} onOpenChange={(o) => { setRotateOpen(o); if (!o) { setNewSecret(""); setSecretErr(null); } }}>
        <DialogContent size="sm">
          <DialogHeader title="Rotate credential" description="Paste the new credential. The old one is replaced immediately and the connection is re-tested." />
          <form noValidate onSubmit={(e) => { e.preventDefault(); if (!newSecret.trim()) return setSecretErr("Enter the new credential."); setSecretErr(null); rotate.mutate(); }}>
            <DialogBody><Field label="New credential" required error={secretErr}>{(p) => <PasswordInput {...p} value={newSecret} onChange={(e) => setNewSecret(e.target.value)} autoComplete="off" />}</Field></DialogBody>
            <DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button type="submit" loading={rotate.isPending}>Rotate and test</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={revokeOpen} onOpenChange={setRevokeOpen} destructive title={`Revoke “${c.displayName}”?`} confirmLabel="Revoke connection" confirmText={c.displayName} loading={revoke.isPending} onConfirm={() => revoke.mutate()}
        description="The secret is deleted from the secret manager. Workflow steps that use this connection will fail until you select another one. This can't be undone." />
    </PageContainer>
  );
}
