import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "primary" | "success" | "warning" | "info" | "danger";

const STOPS: { name: string; detail: string; status: string; tone: Tone; hatched?: boolean }[] = [
  { name: "Webhook received", detail: "order.created", status: "202 accepted", tone: "success" },
  { name: "Verify payment", detail: "HTTP · 214 ms", status: "succeeded", tone: "success" },
  { name: "Generate invoice", detail: "timeout · try 3 of 3", status: "retries used up", tone: "danger" },
  // The hatched segment after this stop is the wait for a person to approve.
  { name: "AI diagnosis", detail: "provider timeout", status: "retry this step", tone: "info", hatched: true },
  { name: "Retry approved", detail: "by an Operator", status: "invoice created", tone: "success" },
  { name: "Notify #billing", detail: "Slack · 1 message", status: "run succeeded", tone: "success" },
];

const RING: Record<Tone, string> = {
  primary: "border-primary",
  success: "border-success",
  warning: "border-warning",
  info: "border-info",
  danger: "border-danger",
};

export const CHIP: Record<Tone, string> = {
  primary: "bg-primary-soft text-primary-soft-fg",
  success: "bg-success-soft text-success-fg",
  warning: "bg-warning-soft text-warning-fg",
  info: "bg-info-soft text-info-fg",
  danger: "bg-danger-soft text-danger-fg",
};

export function StatusChip({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-0.5 font-mono text-xs", CHIP[tone], className)}>{children}</span>;
}

/**
 * One example run drawn as a rail line: horizontal from tablet up, vertical on phones.
 * Each stop's segment runs from its own dot to the next one, so the wait for approval can be hatched on its own.
 */
export function RunRail() {
  return (
    <figure className="mt-12 lg:mt-14">
      <figcaption className="font-mono text-sm text-fg-subtle">
        Example run · <span className="text-fg-muted">invoice-on-order v7</span>
      </figcaption>
      <ol className="mt-6 grid lg:grid-cols-6" aria-label="Example run, step by step">
        {STOPS.map((s, i) => {
          const last = i === STOPS.length - 1;
          return (
            <li key={s.name} className="relative pb-7 pl-12 lg:pb-0 lg:pl-0 lg:pt-14 lg:pr-4" style={{ "--i": i } as React.CSSProperties}>
              {!last && (
                <>
                  {/* Faint track first, so the line reads even before (or without) the draw-in. */}
                  <span aria-hidden className="absolute top-3.5 left-2.5 h-full w-2 rounded-full bg-border lg:top-[22px] lg:left-3.5 lg:h-2 lg:w-full" />
                  <span
                    aria-hidden
                    className={cn("rail-run absolute top-3.5 left-2.5 h-full w-2 rounded-full lg:top-[22px] lg:left-3.5 lg:h-2 lg:w-full", s.hatched ? "rail-hatch" : "bg-primary")}
                  />
                </>
              )}
              {/* A failed stop carries a cross inside its ring, so it never reads as just another Ember stop. */}
              <span aria-hidden className={cn("rail-stop absolute top-0 left-0 flex size-7 items-center justify-center rounded-full border-[6px] bg-surface shadow-sm lg:top-3", RING[s.tone])}>
                {s.tone === "danger" && <X className="size-3 text-danger" strokeWidth={4} />}
              </span>
              <div className="rail-stop flex flex-col gap-1">
                <span className="text-md font-semibold text-fg">{s.name}</span>
                <span className="font-mono text-sm text-fg-subtle">{s.detail}</span>
                <StatusChip tone={s.tone} className="mt-1">{s.status}</StatusChip>
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
