"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useOnChange } from "@/hooks/use-on-change";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlay = "fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in";

/**
 * Modal dialog. Radix provides focus trap, Esc to close, aria-modal, inert background and focus
 * restoration to the trigger on close.
 */
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { size?: "sm" | "md" | "lg" | "xl"; hideClose?: boolean }
>(({ className, children, size = "md", hideClose, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className={overlay} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden border border-border bg-surface text-fg shadow-lg outline-none data-[state=open]:animate-slide-up",
        "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-lg sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg",
        size === "sm" && "sm:max-w-md",
        size === "md" && "sm:max-w-lg",
        size === "lg" && "sm:max-w-2xl",
        size === "xl" && "sm:max-w-4xl",
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="Close">
            <X aria-hidden />
          </Button>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({ title, description, className }: { title: React.ReactNode; description?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 border-b border-border px-5 pt-5 pb-4 pr-12", className)}>
      <DialogPrimitive.Title className="text-lg font-semibold text-fg">{title}</DialogPrimitive.Title>
      {description ? <DialogPrimitive.Description className="text-base text-fg-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>}
    </div>
  );
}

export function DialogBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex-1 overflow-y-auto px-5 py-4", className)}>{children}</div>;
}

export function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex flex-col-reverse gap-2 border-t border-border bg-surface-sunken px-5 py-3 sm:flex-row sm:justify-end", className)}>{children}</div>;
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  loading?: boolean;
  /** Require typing this text to enable the confirm button (high-impact destructive actions). */
  confirmText?: string;
  children?: React.ReactNode;
}

/** Confirmation for destructive or consequential actions (WCAG 3.3.4 error prevention). */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, destructive, loading, confirmText, children }: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  useOnChange(open, (o) => { if (!o) setTyped(""); });
  const blocked = confirmText !== undefined && typed.trim() !== confirmText;
  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent size="sm" role="alertdialog">
        <DialogHeader title={title} description={description} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) void onConfirm();
          }}
        >
          {(children || confirmText) && (
            <DialogBody className="flex flex-col gap-3">
              {children}
              {confirmText && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="confirm-text" className="text-sm font-medium">
                    Type <span className="font-mono font-semibold">{confirmText}</span> to confirm
                  </label>
                  <Input id="confirm-text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
                </div>
              )}
            </DialogBody>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={loading}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant={destructive ? "destructive" : "primary"} loading={loading} disabled={blocked}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Side drawer (desktop) / bottom sheet (mobile). Same focus management as Dialog. */
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: "right" | "left" | "bottom" | "responsive"; widthClass?: string }
>(({ className, children, side = "right", widthClass = "sm:max-w-md", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className={overlay} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col bg-surface text-fg shadow-lg outline-none",
        side === "right" && "inset-y-0 right-0 w-full animate-slide-in-right border-l border-border",
        side === "left" && "inset-y-0 left-0 w-[min(20rem,85vw)] animate-slide-in-left border-r border-border",
        side === "bottom" && "inset-x-0 bottom-0 max-h-[88dvh] animate-slide-up rounded-t-lg border-t border-border",
        side === "responsive" && "inset-x-0 bottom-0 max-h-[88dvh] animate-slide-up rounded-t-lg border-t border-border md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-full md:animate-slide-in-right md:rounded-none md:border-t-0 md:border-l",
        side !== "left" && widthClass,
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close asChild>
        <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="Close panel">
          <X aria-hidden />
        </Button>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";
