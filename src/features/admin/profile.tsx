"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup, SwitchField } from "@/components/ui/checkbox";
import { Avatar, Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, PasswordInput } from "@/components/ui/input";
import { useCurrent, useMe } from "@/hooks/use-current";
import { DeleteAccountPanel } from "./delete-account";
import { TwoFactorPanel } from "./two-factor";
import type { MeInfo } from "@/server/actions/account";
import type { NotificationPrefs } from "@/server/notifications";
import { usePrefs, type ThemePreference } from "@/lib/prefs";
import { ApiError, authApi, errorMessage } from "@/lib/services";
import { hasErrors, validateNewPassword } from "@/lib/validators";

export function ProfileView() {
  const { user } = useCurrent();
  const qc = useQueryClient();
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const me = useMe().data;
  const emailReady = !!me?.emailNotificationsAvailable;
  const savePrefs = useMutation({
    mutationFn: (p: NotificationPrefs) => authApi.updateNotificationPrefs(p),
    onMutate: async (p) => {
      // Optimistic: flip the switch now, roll back if saving fails.
      await qc.cancelQueries({ queryKey: ["me"] });
      const prev = qc.getQueryData<MeInfo>(["me"]);
      if (prev) qc.setQueryData<MeInfo>(["me"], { ...prev, user: { ...prev.user, notificationPrefs: p } });
      return { prev };
    },
    onError: (e, _p, c) => { if (c?.prev) qc.setQueryData(["me"], c.prev); toast.error("Couldn't save the preference", { description: errorMessage(e) }); },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["me"] }); toast.success("Preference saved"); },
  });
  const prefs = me?.user.notificationPrefs;
  const setPref = (k: keyof NotificationPrefs, ch: "inApp" | "email", v: boolean) => { if (prefs) savePrefs.mutate({ ...prefs, [k]: { ...prefs[k], [ch]: v } }); };
  const [name, setName] = React.useState(user?.name ?? "");
  const [title, setTitle] = React.useState(user?.title ?? "");
  const [nameErr, setNameErr] = React.useState<string | null>(null);
  const [pw, setPw] = React.useState({ current: "", next: "", confirm: "" });
  const [pwErr, setPwErr] = React.useState<Record<string, string | null>>({});

  const profile = useMutation({ mutationFn: () => authApi.updateProfile({ name, title }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["me"] }); toast.success("Profile updated"); }, onError: (e) => toast.error(errorMessage(e)) });
  const password = useMutation({ mutationFn: () => authApi.changePassword(user!.email, pw.current, pw.next), onSuccess: () => { setPw({ current: "", next: "", confirm: "" }); toast.success("Password changed"); }, onError: (e) => { if (e instanceof ApiError && e.fieldErrors?.currentPassword) setPwErr({ current: e.fieldErrors.currentPassword }); else toast.error(errorMessage(e)); } });
  if (!user) return null;
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="Profile settings" description="Your personal details and preferences. These apply across all your workspaces." />
      <div className="flex flex-col gap-5">
        <Panel aria-labelledby="p-h"><PanelHeader id="p-h" title="Personal details" />
          <form noValidate onSubmit={(e) => { e.preventDefault(); const er = name.trim().length < 2 ? "Enter your full name." : null; setNameErr(er); if (!er) profile.mutate(); }}>
            <PanelBody className="flex flex-col gap-4">
              <div className="flex items-center gap-3"><Avatar name={name || user.email} size="lg" /><p className="text-sm text-fg-muted">Your avatar uses your initials.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required error={nameErr}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
                <Field label="Job title" optional>{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="organization-title" />}</Field>
                <Field label="Email" description="Contact an owner to change the email you sign in with.">{(p) => <Input {...p} value={user.email} readOnly />}</Field>
              </div>
            </PanelBody>
            <div className="flex justify-end border-t border-border px-4 py-3"><Button type="submit" loading={profile.isPending}>Save profile</Button></div>
          </form>
        </Panel>
        <Panel aria-labelledby="pw-h"><PanelHeader id="pw-h" title="Password" />
          <form noValidate onSubmit={(e) => { e.preventDefault(); const er = { current: pw.current ? null : "Enter your current password.", next: validateNewPassword(pw.next), confirm: pw.confirm === pw.next ? null : "Passwords don't match." }; setPwErr(er); if (!hasErrors(er)) password.mutate(); }}>
            <PanelBody className="grid gap-4 sm:grid-cols-3">
              <Field label="Current password" required error={pwErr.current}>{(p) => <PasswordInput {...p} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />}</Field>
              <Field label="New password" required error={pwErr.next} description="10+ characters with a letter and a number.">{(p) => <PasswordInput {...p} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />}</Field>
              <Field label="Confirm new password" required error={pwErr.confirm}>{(p) => <PasswordInput {...p} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />}</Field>
            </PanelBody>
            <div className="flex justify-end border-t border-border px-4 py-3"><Button type="submit" loading={password.isPending}>Change password</Button></div>
          </form>
        </Panel>
        <TwoFactorPanel />
        <Panel aria-labelledby="th-h"><PanelHeader id="th-h" title="Appearance" />
          <PanelBody>
            <RadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)} className="sm:grid-cols-3" aria-label="Theme">
              <RadioCard id="th-light" value="light" icon={<Sun className="size-4" />} label="Light" />
              <RadioCard id="th-dark" value="dark" icon={<Moon className="size-4" />} label="Dark" />
              <RadioCard id="th-system" value="system" icon={<Monitor className="size-4" />} label="System" description="Follow your device" />
            </RadioGroup>
          </PanelBody>
        </Panel>
        <Panel aria-labelledby="n-h"><PanelHeader id="n-h" title="Notifications" description="Everything always appears in the bell menu. These choose what also pops up or gets emailed to you. Saved to your account, so they apply on every device." />
          <PanelBody className="flex flex-col gap-4">
            {prefs && (
              <>
                <fieldset className="flex flex-col divide-y divide-border">
                  <legend className="mb-1 font-medium">Run failures</legend>
                  <SwitchField id="n-fail-app" label="Pop-up in the app" description="A toast when a run fails in your current workspace." checked={prefs.runFailures.inApp} disabled={savePrefs.isPending} onCheckedChange={(v) => setPref("runFailures", "inApp", v)} />
                  <SwitchField id="n-fail-email" label="Email" description="An email each time a run fails in any of your workspaces." checked={prefs.runFailures.email} disabled={!emailReady || savePrefs.isPending} onCheckedChange={(v) => setPref("runFailures", "email", v)} />
                </fieldset>
                <fieldset className="flex flex-col divide-y divide-border">
                  <legend className="mb-1 font-medium">Approval requests</legend>
                  <SwitchField id="n-appr-app" label="Pop-up in the app" description="A toast when a recovery action needs approval. Only for people who can approve." checked={prefs.approvals.inApp} disabled={savePrefs.isPending} onCheckedChange={(v) => setPref("approvals", "inApp", v)} />
                  <SwitchField id="n-appr-email" label="Email" description="An email when a recovery action needs your approval." checked={prefs.approvals.email} disabled={!emailReady || savePrefs.isPending} onCheckedChange={(v) => setPref("approvals", "email", v)} />
                </fieldset>
                {!emailReady && <p className="text-sm text-fg-muted">Email notifications are off for this FlowForge installation. An administrator can turn them on by setting <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> (see SETUP.md).</p>}
              </>
            )}
          </PanelBody>
        </Panel>
        <DeleteAccountPanel />
      </div>
    </PageContainer>
  );
}
