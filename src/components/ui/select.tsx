"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { AlertCircle, Check, ChevronDown, Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { inputClass } from "./input";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Optional leading element (icon, status dot). Must not carry meaning by color alone. */
  icon?: React.ReactNode;
}

export interface SelectProps<V extends string = string> {
  value: V | undefined;
  onValueChange: (value: V) => void;
  options: ReadonlyArray<SelectOption<V>>;
  placeholder?: string;
  id?: string;
  /** Accessible name when no visible <label for> is wired. */
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  className?: string;
  contentClassName?: string;
  size?: "sm" | "md";
  name?: string;
}

/**
 * Accessible single-select built on Radix (listbox semantics, typeahead, arrow keys, Esc,
 * outside click). Loading, error and empty states are rendered inside the listbox.
 */
export function Select<V extends string = string>({
  value, onValueChange, options, placeholder = "Select…", id, disabled, loading, error, emptyMessage = "No options available", className, contentClassName, size = "md", name, ...aria
}: SelectProps<V>) {
  const selected = options.find((o) => o.value === value);
  return (
    <SelectPrimitive.Root value={value ?? ""} onValueChange={(v) => onValueChange(v as V)} disabled={disabled} name={name}>
      <SelectPrimitive.Trigger
        id={id}
        className={cn(inputClass, "items-center justify-between gap-2 text-left data-[placeholder]:text-fg-subtle", size === "sm" && "h-8 text-sm", className)}
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={aria["aria-invalid"]}
        aria-required={aria["aria-required"]}
        aria-busy={loading || undefined}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.icon}
          <SelectPrimitive.Value placeholder={loading ? "Loading…" : placeholder}>{selected?.label}</SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon asChild>
          {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-fg-subtle" aria-hidden /> : <ChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 max-h-[min(var(--radix-select-content-available-height),22rem)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface-raised text-fg shadow-md data-[state=open]:animate-fade-in",
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {loading && (
              <div className="flex items-center gap-2 px-2 py-2 text-sm text-fg-muted" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading options…
              </div>
            )}
            {!loading && error && (
              <div className="flex items-center gap-2 px-2 py-2 text-sm text-danger-fg dark:text-danger" role="alert">
                <AlertCircle className="size-4" aria-hidden /> {error}
              </div>
            )}
            {!loading && !error && options.length === 0 && <div className="px-2 py-2 text-sm text-fg-muted">{emptyMessage}</div>}
            {!loading &&
              !error &&
              options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className="relative flex min-h-9 cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-base outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover data-[state=checked]:font-medium"
                >
                  {o.icon}
                  <div className="flex min-w-0 flex-col">
                    <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                    {o.description && <span className="text-sm text-fg-muted">{o.description}</span>}
                  </div>
                  <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex">
                    <Check className="size-4 text-primary" aria-hidden />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
