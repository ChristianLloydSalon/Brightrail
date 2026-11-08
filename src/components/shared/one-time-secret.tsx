"use client";

import { Eye, EyeOff, ShieldAlert } from "lucide-react";
import { useOnChange } from "@/hooks/use-on-change";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/code";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { CheckboxField } from "@/components/ui/checkbox";

/**
 * Shows a newly generated secret exactly once. Masked by default; the value only exists in this
 * component's props and is dropped when the dialog closes.
 */
export function OneTimeSecretDialog({ open, title, secret, onClose, hint, note }: { open: boolean; title: string; secret: string | null; onClose: () => void; hint?: string; note?: React.ReactNode }) {
  const [revealed, setRevealed] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  useOnChange(open, (o) => { if (!o) { setRevealed(false); setAck(false); } });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && ack) onClose(); }}>
      <DialogContent size="md" hideClose onEscapeKeyDown={(e) => { if (!ack) e.preventDefault(); }} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader title={title} description="Copy it now and store it in your secret manager. Brightrail won't show it again." />
        <DialogBody className="flex flex-col gap-4">
          <Alert tone="warning"><ShieldAlert className="hidden" aria-hidden />Anyone with this value can act with its permissions. Don't paste it into chat, tickets or code.</Alert>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-sunken p-2">
            <code className="min-w-0 flex-1 truncate font-mono text-sm" aria-label={revealed ? "Secret value" : "Secret value, hidden"}>{revealed ? secret : "•".repeat(32)}</code>
            <Button variant="ghost" size="icon-sm" onClick={() => setRevealed((r) => !r)} aria-label={revealed ? "Hide secret" : "Reveal secret"} aria-pressed={revealed}>{revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</Button>
            {secret && <CopyButton value={secret} />}
          </div>
          {note && <p className="text-sm">{note}</p>}
          {hint && <p className="text-sm text-fg-muted">Afterwards it will be identified as <code className="font-mono">{hint}</code>.</p>}
          <CheckboxField id="ack-secret" checked={ack} onCheckedChange={setAck} label="I've stored this secret somewhere safe" />
        </DialogBody>
        <DialogFooter><Button onClick={onClose} disabled={!ack}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
