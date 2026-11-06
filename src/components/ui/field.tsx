"use client";

import { AlertCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface FieldControlProps {
  id: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
  required?: boolean;
}

interface FieldProps {
  label: React.ReactNode;
  /** Explicit id; one is generated otherwise. */
  id?: string;
  description?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  className?: string;
  labelAction?: React.ReactNode;
  children: (control: FieldControlProps) => React.ReactNode;
}

/**
 * Form field wrapper: wires label, description and error to the control with ids so screen readers
 * announce them (WCAG 1.3.1, 3.3.1, 3.3.2).
 */
export function Field({ label, id, description, error, required, optional, className, labelAction, children }: FieldProps) {
  const auto = React.useId();
  const controlId = id ?? `f${auto.replace(/:/g, "")}`;
  const descId = description ? `${controlId}-desc` : undefined;
  const errId = error ? `${controlId}-err` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={controlId} className="text-sm font-medium text-fg">
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          )}
          {optional && <span className="ml-1.5 font-normal text-fg-subtle">Optional</span>}
        </label>
        {labelAction}
      </div>
      {children({
        id: controlId,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": [descId, errId].filter(Boolean).join(" ") || undefined,
        "aria-required": required || undefined,
        required,
      })}
      {description && (
        <p id={descId} className="text-sm text-fg-muted">
          {description}
        </p>
      )}
      {error && (
        <p id={errId} className="flex items-start gap-1.5 text-sm text-danger-fg dark:text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** Fieldset for groups of related controls (radio groups, checkbox sets). */
export function Fieldset({ legend, description, error, children, className }: { legend: React.ReactNode; description?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  const id = React.useId();
  return (
    <fieldset className={cn("flex flex-col gap-2", className)} aria-describedby={error ? `${id}-err` : description ? `${id}-desc` : undefined}>
      <legend className="mb-1 text-sm font-medium text-fg">{legend}</legend>
      {description && <p id={`${id}-desc`} className="-mt-1 text-sm text-fg-muted">{description}</p>}
      {children}
      {error && (
        <p id={`${id}-err`} className="flex items-start gap-1.5 text-sm text-danger-fg dark:text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Polite live region that announces a summary when a form submit fails validation. */
export function FormErrorSummary({ errors, title = "Please fix the following" }: { errors: Array<{ id: string; message: string }>; title?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (errors.length) ref.current?.focus();
  }, [errors.length]);
  if (!errors.length) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded-md border border-danger-border bg-danger-soft p-3 text-sm text-danger-fg outline-none">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc pl-5">
        {errors.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`} className="underline underline-offset-2" onClick={(ev) => { ev.preventDefault(); document.getElementById(e.id)?.focus(); }}>
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
