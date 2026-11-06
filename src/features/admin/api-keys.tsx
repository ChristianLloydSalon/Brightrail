"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { Ban, KeyRound, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { OneTimeSecretDialog } from "@/components/shared/one-time-secret";
import { RelativeTime } from "@/components/shared/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mono, Panel } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog, Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import { API_KEY_SCOPES, type ApiKey, type ApiKeyScope } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";
import { ApiError, apiKeysApi, errorMessage } from "@/lib/services";
import { useWorkspaceId } from "@/hooks/use-current";

const SCOPE_DESC: Record<ApiKeyScope, string> = { "workflows:read": "List and read workflows", "workflows:write": "Create drafts and publish", "runs:read": "Read runs and logs", "runs:trigger": "Start runs", "webhooks:manage": "Manage webhook endpoints", "audit:read": "Read the audit log" };

export function ApiKeysView() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["api-keys", ws], queryFn: () => apiKeysApi.list() });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [v, setV] = React.useState<{ name: string; scopes: ApiKeyScope[]; expires: string }>({ name: "", scopes: [], expires: "90" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [secret, setSecret] = React.useState<{ value: string; hint: string } | null>(null);
  const [revoking, setRevoking] = React.useState<ApiKey | null>(null);
  useOnChange(createOpen, (o) => { if (!o) { setV({ name: "", scopes: [], expires: "90" }); setErrors({}); } });
  const create = useMutation({ mutationFn: () => apiKeysApi.create({ name: v.name, scopes: v.scopes, expiresInDays: v.expires === "never" ? null : Number(v.expires) }), onSuccess: async (r) => { await qc.invalidateQueries(); setCreateOpen(false); setSecret({ value: r.secret, hint: `${r.key.prefix}${r.key.hint}` }); }, onError: (e) => { if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors); } });
  const revoke = useMutation({ mutationFn: (id: string) => apiKeysApi.revoke(id), onSuccess: async () => { setRevoking(null); await qc.invalidateQueries(); toast.success("API key revoked", { description: "Requests using it now get 401." }); }, onError: (e) => toast.error(errorMessage(e)) });
  const cols: Column<ApiKey & { createdByName: string }>[] = [
    { id: "name", header: "Name", cell: (k) => <div className="flex flex-col"><span className="font-medium">{k.name}</span><Mono className="w-fit">{k.prefix}{k.hint}</Mono></div> },
    { id: "scopes", header: "Scopes", hideBelow: "lg", cell: (k) => <div className="flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} tone="neutral" className="font-mono text-xs font-normal">{s}</Badge>)}</div> },
    { id: "used", header: "Last used", cell: (k) => <RelativeTime iso={k.lastUsedAt} className="text-sm" /> },
    { id: "exp", header: "Expires", cell: (k) => { const soon = k.expiresAt && new Date(k.expiresAt).getTime() - Date.now() < 14 * 86400_000; return <span className={soon && k.status === "active" ? "text-sm text-warning-fg" : "text-sm text-fg-muted"}>{k.expiresAt ? formatDate(k.expiresAt) : "Never"}{soon && k.status === "active" ? " (soon)" : ""}</span>; } },
    { id: "status", header: "Status", cell: (k) => <Badge tone={k.status === "active" ? "success" : "neutral"}>{k.status === "active" ? "Active" : "Revoked"}</Badge> },
    { id: "a", header: <span className="sr-only">Actions</span>, align: "right", cell: (k) => k.status === "active" && <Button variant="ghost" size="sm" onClick={() => setRevoking(k)}><Ban aria-hidden /> Revoke<span className="sr-only"> {k.name}</span></Button> },
  ];
  return (
    <PageContainer>
      <PageHeader title="API keys" description="Workspace-scoped keys for the FlowForge REST API (/api/v1). Grant only the scopes a client needs." actions={<Button onClick={() => setCreateOpen(true)}><Plus aria-hidden /> Create API key</Button>} />
      <Panel>
        <DataTable caption="API keys" columns={cols} rows={q.data} getRowId={(k) => k.id} isLoading={q.isPending} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          empty={<EmptyState icon={<KeyRound />} title="No API keys" description="Create a key to call the API from CI or another service." action={<Button onClick={() => setCreateOpen(true)}>Create API key</Button>} />}
          mobileCard={(k) => <div className="flex flex-col gap-1.5"><span className="flex items-center justify-between gap-2 font-medium">{k.name}<Badge tone={k.status === "active" ? "success" : "neutral"}>{k.status === "active" ? "Active" : "Revoked"}</Badge></span><Mono className="w-fit">{k.prefix}{k.hint}</Mono><span className="text-sm text-fg-muted">{k.scopes.join(", ")}</span>{k.status === "active" && <Button variant="outline" size="sm" className="w-fit" onClick={() => setRevoking(k)}>Revoke</Button>}</div>} />
      </Panel>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent size="md">
          <DialogHeader title="Create API key" description="The full key is shown once after creation." />
          <form noValidate onSubmit={(e) => { e.preventDefault(); const er: Record<string, string> = {}; if (v.name.trim().length < 3) er.name = "Use at least 3 characters."; if (!v.scopes.length) er.scopes = "Choose at least one scope."; setErrors(er); if (!Object.keys(er).length) create.mutate(); }}>
            <DialogBody className="flex flex-col gap-4">
              {create.isError && !(create.error instanceof ApiError && create.error.fieldErrors) && <Alert tone="danger" role="alert">{errorMessage(create.error)}</Alert>}
              <Field label="Name" required error={errors.name} description="Where it's used, e.g. “CI deploy pipeline”.">{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
              <Field label="Scopes" required error={errors.scopes}>{(p) => <MultiSelect {...p} value={v.scopes} onValueChange={(s) => setV({ ...v, scopes: s })} options={API_KEY_SCOPES.map((s) => ({ value: s, label: s, description: SCOPE_DESC[s] }))} placeholder="Choose scopes" />}</Field>
              <Field label="Expires">{(p) => <Select {...p} value={v.expires} onValueChange={(x) => setV({ ...v, expires: x })} options={[{ value: "30", label: "In 30 days" }, { value: "90", label: "In 90 days (recommended)" }, { value: "365", label: "In 1 year" }, { value: "never", label: "Never", description: "Not recommended" }]} />}</Field>
            </DialogBody>
            <DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button type="submit" loading={create.isPending}>Create key</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <OneTimeSecretDialog open={!!secret} title="API key created" secret={secret?.value ?? null} hint={secret?.hint} onClose={() => setSecret(null)} />
      <ConfirmDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} destructive title={`Revoke “${revoking?.name}”?`} confirmLabel="Revoke key" loading={revoke.isPending}
        description="Any client using this key stops working immediately. This can't be undone." onConfirm={() => { if (revoking) revoke.mutate(revoking.id); }} />
    </PageContainer>
  );
}
