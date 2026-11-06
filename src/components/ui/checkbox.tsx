"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, Minus } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer flex size-4.5 shrink-0 items-center justify-center rounded-xs border border-input-border bg-surface shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-fg",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>{props.checked === "indeterminate" ? <Minus className="size-3.5" strokeWidth={3} /> : <Check className="size-3.5" strokeWidth={3} />}</CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";

/** Checkbox with a clickable label and optional description, sized for touch. */
export function CheckboxField({ id, label, description, checked, onCheckedChange, disabled }: { id: string; label: React.ReactNode; description?: React.ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} disabled={disabled} className="mt-0.5" aria-describedby={description ? `${id}-d` : undefined} />
      <div className="flex flex-col">
        <label htmlFor={id} className="cursor-pointer text-base text-fg peer-disabled:cursor-not-allowed">
          {label}
        </label>
        {description && <span id={`${id}-d`} className="text-sm text-fg-muted">{description}</span>}
      </div>
    </div>
  );
}

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-[var(--input-border)]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-4.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:bg-surface-raised dark:data-[state=checked]:bg-fg-inverse" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";

/** Labelled switch row. The visible state text means status never relies on color/position alone. */
export function SwitchField({ id, label, description, checked, onCheckedChange, disabled, locked }: { id: string; label: React.ReactNode; description?: React.ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; locked?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-base font-medium text-fg">
          {label}
        </label>
        {description && <span id={`${id}-d`} className="text-sm text-fg-muted">{description}</span>}
        {locked && <span className="mt-1 text-sm text-fg-subtle">{locked}</span>}
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-sm text-fg-muted" aria-hidden>
          {checked ? "On" : "Off"}
        </span>
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-describedby={description ? `${id}-d` : undefined} />
      </div>
    </div>
  );
}

export const RadioGroup = React.forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Root>, React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-2", className)} {...props} />
));
RadioGroup.displayName = "RadioGroup";

export function RadioCard({ value, id, label, description, icon }: { value: string; id: string; label: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface p-3 transition-colors hover:bg-surface-hover has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft"
    >
      <RadioGroupPrimitive.Item
        id={id}
        value={value}
        className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border border-input-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[state=checked]:border-primary"
        aria-describedby={description ? `${id}-d` : undefined}
      >
        <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-primary" />
      </RadioGroupPrimitive.Item>
      {icon && <span className="mt-0.5 text-fg-muted">{icon}</span>}
      <span className="flex flex-col">
        <span className="text-base font-medium text-fg">{label}</span>
        {description && <span id={`${id}-d`} className="text-sm text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}
