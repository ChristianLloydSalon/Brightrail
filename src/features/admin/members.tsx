"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { Crown, MoreHorizontal, RefreshCw, UserMinus, UserPlus, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { RelativeTime } from "@/components/shared/time";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, Panel } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog, Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { SearchInput, Textarea } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import { assignableRoles, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/domain/permissions";
import { MEMBER_STATUS_META } from "@/lib/domain/status";
import { ROLES, type Role } from "@/lib/domain/types";
import { ApiError, errorMessage, membersApi } from "@/lib/services";
import type { MemberRow } from "@/lib/services/types";
import { EMAIL_RE } from "@/lib/validators";

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { role } = useCurrent();
  const roles = role ? assignableRoles(role) : [];
  const [emails, setEmails] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<Role | undefined>("operator");
  const [message, setMessage] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const qc = useQueryClient();
  useOnChange(open, (o) => { if (!o) { setEmails(""); setMessage(""); setErrors({}); setInviteRole("operator"); } });
  const m = useMutation({
    mutationFn: () => membersApi.invite({ emails: emails.split(/[\s,;]+/), role: inviteRole!, message }),
    onSuccess: async (r) => { await qc.invalidateQueries(); onOpenChange(false); toast.success(`${r.length} invitation${r.length === 1 ? "" : "s"} sent`, { description: `As ${ROLE_LABELS[r[0]!.role]}. They'll appear as Invited until they accept.` }); },
    onError: (e) => { if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Invite members" description="Invitations expire after 7 days. You can change roles later." />
        <form noValidate onSubmit={(e) => {
          e.preventDefault();
          const list = emails.split(/[\s,;]+/).filter(Boolean);
          const er: Record<string, string> = {};
          if (!list.length) er.emails = "Enter at least one email address.";
          else if (list.some((x) => !EMAIL_RE.test(x))) er.emails = `Not a valid email: ${list.filter((x) => !EMAIL_RE.test(x)).join(", ")}`;
          if (!inviteRole) er.role = "Choose a role.";
          setErrors(er);
          if (!Object.keys(er).length) m.mutate();
        }}>
          <DialogBody className="flex flex-col gap-4">
            {m.isError && !(m.error instanceof ApiError && m.error.fieldErrors) && <Alert tone="danger" role="alert">{errorMessage(m.error)}</Alert>}
            <Field label="Email addresses" required error={errors.emails} description="Separate several addresses with commas or new lines.">
              {(p) => <Textarea {...p} rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@company.com" autoFocus />}
            </Field>
            <Field label="Role" required error={errors.role}>
              {(p) => <Select<Role> {...p} value={inviteRole} onValueChange={setInviteRole} emptyMessage="Your role can't invite members" options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_DESCRIPTIONS[r] }))} />}
            </Field>
            <Field label="Personal message" optional>{(p) => <Textarea {...p} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} />}</Field>
          </DialogBody>
          <DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button type="submit" loading={m.isPending} loadingText="Sending…"><UserPlus aria-hidden /> Send invitations</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MembersView() {
  const ws = useWorkspaceId();
  const { can, role: myRole } = useCurrent();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [role, setRole] = React.useState<Role | "all">("all");
  const [status, setStatus] = React.useState<"all" | "active" | "invited" | "suspended">("all");
  const [inviteOpen, setInviteOpen] = React.useState(params.get("invite") === "1");
  const [removing, setRemoving] = React.useState<MemberRow | null>(null);
  const q = useQuery({ queryKey: ["members", ws, search, role, status], queryFn: () => membersApi.list({ search, role, status }) });
  const manage = can("members.manage");
  const done = (msg: string) => async () => { await qc.invalidateQueries(); toast.success(msg); };
  const onErr = (e: unknown) => toast.error(errorMessage(e));
  const changeRole = useMutation({ mutationFn: (v: { id: string; role: Role }) => membersApi.changeRole(v.id, v.role), onSuccess: (m) => done(`${m.name || m.email} is now ${ROLE_LABELS[m.role]}`)(), onError: onErr });
  const suspend = useMutation({ mutationFn: (v: { id: string; s: boolean }) => membersApi.setSuspended(v.id, v.s), onSuccess: (m) => done(m.status === "suspended" ? "Member suspended" : "Member reactivated")(), onError: onErr });
  const resend = useMutation({ mutationFn: (id: string) => membersApi.resendInvite(id), onSuccess: done("Invitation resent"), onError: onErr });
  const remove = useMutation({ mutationFn: (id: string) => membersApi.remove(id), onSuccess: () => { setRemoving(null); return done("Member removed")(); }, onError: onErr });
  const [makeOwner, setMakeOwner] = React.useState<MemberRow | null>(null);
  const transfer = useMutation({ mutationFn: (id: string) => membersApi.transferOwnership(id), onSuccess: async () => { const name = makeOwner?.name || makeOwner?.email; setMakeOwner(null); await qc.invalidateQueries(); toast.success(`${name} now owns this workspace`, { description: "You're now an Admin." }); }, onError: onErr });
  const assignable = myRole ? assignableRoles(myRole) : [];

  const columns: Column<MemberRow>[] = [
    { id: "name", header: "Member", cell: (m) => <div className="flex items-center gap-3"><Avatar name={m.name || m.email} /><div className="flex min-w-0 flex-col"><span className="font-medium">{m.name || "Pending invite"}{m.isYou && <span className="ml-1.5 text-sm font-normal text-fg-muted">(you)</span>}</span><span className="truncate text-sm text-fg-muted">{m.email}</span></div></div> },
    {
      id: "role", header: "Role", cell: (m) => {
        const editable = manage && !m.isYou && m.role !== "owner" && !(myRole === "admin" && m.role === "admin");
        return editable ? (
          <Select<Role> size="sm" aria-label={`Role for ${m.name || m.email}`} value={m.role} className="w-36" disabled={changeRole.isPending}
            onValueChange={(r) => changeRole.mutate({ id: m.id, role: r })} options={ROLES.filter((r) => r !== "owner").map((r) => ({ value: r, label: ROLE_LABELS[r], disabled: !assignable.includes(r) }))} />
        ) : <span className="text-base">{ROLE_LABELS[m.role]}</span>;
      },
    },
    { id: "status", header: "Status", cell: (m) => <StatusBadge meta={MEMBER_STATUS_META[m.status]} /> },
    { id: "active", header: "Last active", hideBelow: "lg", cell: (m) => m.status === "invited" ? <span className="text-sm text-fg-muted">Invited <RelativeTime iso={m.invitedAt} /></span> : <RelativeTime iso={m.lastActiveAt} className="text-sm text-fg-muted" /> },
    {
      id: "actions", header: <span className="sr-only">Actions</span>, align: "right", cell: (m) => manage && !m.isYou && m.role !== "owner" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.name || m.email}`}><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger>
          <DropdownMenuContent>
            {m.status === "invited" && <DropdownMenuItem onSelect={() => resend.mutate(m.id)}><RefreshCw aria-hidden /> Resend invitation</DropdownMenuItem>}
            {m.status !== "invited" && <DropdownMenuItem onSelect={() => suspend.mutate({ id: m.id, s: m.status !== "suspended" })}>{m.status === "suspended" ? "Reactivate" : "Suspend access"}</DropdownMenuItem>}
            {myRole === "owner" && m.status === "active" && <DropdownMenuItem onSelect={() => setMakeOwner(m)}><Crown aria-hidden /> Make owner…</DropdownMenuItem>}
            <DropdownMenuItem destructive onSelect={() => setRemoving(m)}><UserMinus aria-hidden /> {m.status === "invited" ? "Revoke invitation" : "Remove from workspace"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null,
    },
  ];
  const filtered = search || role !== "all" || status !== "all";
  return (
    <PageContainer>
      <PageHeader title="Members" description="People with access to this workspace and what they can do." actions={manage && <Button onClick={() => setInviteOpen(true)}><UserPlus aria-hidden /> Invite members</Button>} />
      <Panel>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
          <SearchInput label="Search members" placeholder="Search by name or email" value={search} onValueChange={setSearch} className="sm:w-72" />
          <Select aria-label="Filter by role" value={role} onValueChange={setRole} className="sm:w-40" options={[{ value: "all", label: "All roles" }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))]} />
          <Select aria-label="Filter by status" value={status} onValueChange={setStatus} className="sm:w-40" options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "invited", label: "Invited" }, { value: "suspended", label: "Suspended" }]} />
        </div>
        <DataTable caption="Workspace members" columns={columns} rows={q.data} getRowId={(m) => m.id} isLoading={q.isPending} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          empty={<EmptyState icon={<Users />} title={filtered ? "No members match" : "No members"} action={filtered && <Button variant="outline" onClick={() => { setSearch(""); setRole("all"); setStatus("all"); }}>Clear filters</Button>} />}
          mobileCard={(m) => <div className="flex flex-col gap-2"><div className="flex items-center gap-3"><Avatar name={m.name || m.email} /><div className="min-w-0 flex-1"><p className="font-medium">{m.name || "Pending invite"}</p><p className="truncate text-sm text-fg-muted">{m.email}</p></div><StatusBadge meta={MEMBER_STATUS_META[m.status]} /></div><div className="flex items-center justify-between gap-2">{columns[1]!.cell(m)}{columns[4]!.cell(m)}</div></div>} />
      </Panel>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <ConfirmDialog open={!!makeOwner} onOpenChange={(o) => !o && setMakeOwner(null)} destructive loading={transfer.isPending}
        title={`Make ${makeOwner?.name || makeOwner?.email} the owner?`} confirmLabel="Transfer ownership"
        description="A workspace has one owner. They'll get full control, including deleting the workspace, and you'll become an Admin. Only the new owner can undo this."
        onConfirm={() => { if (makeOwner) transfer.mutate(makeOwner.id); }} />
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive loading={remove.isPending}
        title={removing?.status === "invited" ? "Revoke invitation?" : `Remove ${removing?.name}?`} confirmLabel={removing?.status === "invited" ? "Revoke invitation" : "Remove member"}
        description={removing?.status === "invited" ? `${removing?.email} won't be able to join with this invitation.` : "They lose access immediately. Workflows they own stay in the workspace."}
        onConfirm={() => { if (removing) remove.mutate(removing.id); }} />
    </PageContainer>
  );
}
