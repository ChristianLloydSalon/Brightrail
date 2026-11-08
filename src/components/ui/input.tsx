"use client";

import { Eye, EyeOff, Search, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input-border bg-surface px-3 text-base text-fg shadow-xs transition-colors placeholder:text-fg-subtle hover:border-fg-subtle focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-disabled aria-[invalid=true]:border-danger read-only:bg-surface-sunken";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type = "text", ...props }, ref) => (
  <input ref={ref} type={type} className={cn(inputClass, type === "number" && "tabular", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(inputClass, "min-h-20 py-2 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">>(({ className, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input ref={ref} type={visible ? "text" : "password"} className={cn(inputClass, "pr-11", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={props.id}
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onValueChange: (v: string) => void;
  label: string;
}

/** Search field with a visible clear button. `label` is announced to assistive tech. */
export function SearchInput({ value, onValueChange, label, className, placeholder, ...props }: SearchInputProps) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
      <input
        ref={ref}
        type="search"
        role="searchbox"
        aria-label={label}
        value={value}
        placeholder={placeholder ?? label}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onValueChange("");
          }
        }}
        className={cn(inputClass, "pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden")}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onValueChange("");
            ref.current?.focus();
          }}
          className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg"
          aria-label="Clear search"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
