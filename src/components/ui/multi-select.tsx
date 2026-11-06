"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { inputClass } from "./input";
import type { SelectOption } from "./select";

interface MultiSelectProps<V extends string> {
  id?: string;
  value: V[];
  onValueChange: (v: V[]) => void;
  options: ReadonlyArray<SelectOption<V>>;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  emptyMessage?: string;
}

/**
 * Multi-select listbox (aria-multiselectable). Arrow keys move, Space/Enter toggles, Esc closes and
 * returns focus to the trigger. Selected values are shown as removable chips.
 */
export function MultiSelect<V extends string>({ id, value, onValueChange, options, placeholder = "Select…", disabled, searchable = true, emptyMessage = "No matches", ...aria }: MultiSelectProps<V>) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const toggle = (v: V) => onValueChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const listRef = React.useRef<HTMLUListElement>(null);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(filtered.length - 1); }
    else if ((e.key === "Enter" || (e.key === " " && !searchable)) && filtered[active]) { e.preventDefault(); if (!filtered[active]!.disabled) toggle(filtered[active]!.value); }
  };
  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="flex flex-col gap-2">
      <PopoverPrimitive.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); setActive(0); }}>
        <PopoverPrimitive.Trigger
          id={id}
          disabled={disabled}
          className={cn(inputClass, "items-center justify-between text-left")}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-describedby={aria["aria-describedby"]}
          aria-invalid={aria["aria-invalid"]}
        >
          <span className={cn("truncate", value.length === 0 && "text-fg-subtle")}>
            {value.length === 0 ? placeholder : `${value.length} selected`}
          </span>
          <ChevronDown className="size-4 text-fg-subtle" aria-hidden />
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content align="start" sideOffset={4} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 rounded-md border border-border bg-surface-raised p-1 shadow-md data-[state=open]:animate-fade-in" onKeyDown={onKey}>
            {searchable && (
              <input
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                placeholder="Filter…"
                aria-label="Filter options"
                aria-controls={listId}
                aria-activedescendant={filtered[active] ? `${listId}-${filtered[active]!.value}` : undefined}
                className={cn(inputClass, "mb-1 h-8 text-sm")}
              />
            )}
            <ul ref={listRef} id={listId} role="listbox" aria-multiselectable="true" tabIndex={searchable ? -1 : 0} className="max-h-64 overflow-auto outline-none" aria-label="Options">
              {filtered.length === 0 && <li className="px-2 py-2 text-sm text-fg-muted">{emptyMessage}</li>}
              {filtered.map((o, i) => {
                const sel = value.includes(o.value);
                return (
                  <li
                    key={o.value}
                    id={`${listId}-${o.value}`}
                    data-index={i}
                    role="option"
                    aria-selected={sel}
                    aria-disabled={o.disabled || undefined}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => !o.disabled && toggle(o.value)}
                    className={cn("flex min-h-9 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-base", i === active && "bg-surface-hover", o.disabled && "opacity-50")}
                  >
                    <span className={cn("flex size-4 items-center justify-center rounded-xs border", sel ? "border-primary bg-primary text-primary-fg" : "border-input-border")}>
                      {sel && <Check className="size-3" strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="flex flex-col">
                      <span>{o.label}</span>
                      {o.description && <span className="text-sm text-fg-muted">{o.description}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected">
          {value.map((v) => {
            const o = options.find((x) => x.value === v);
            return (
              <li key={v} className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-sunken py-0.5 pr-0.5 pl-2 text-sm">
                <span className="font-mono text-xs">{o?.label ?? v}</span>
                <button type="button" onClick={() => toggle(v)} className="flex size-6 items-center justify-center rounded-xs text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={`Remove ${o?.label ?? v}`} disabled={disabled}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
