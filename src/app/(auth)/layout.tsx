import Link from "next/link";
import { Logo } from "@/components/layout/logo";

function FlowIllustration() {
  const nodes = [
    { x: 24, y: 40, label: "order.created", tone: "var(--primary)" },
    { x: 24, y: 120, label: "Verify payment", tone: "var(--success)" },
    { x: 24, y: 200, label: "Generate invoice", tone: "var(--danger)" },
    { x: 24, y: 280, label: "Retry approved", tone: "var(--info)" },
  ];
  return (
    <svg viewBox="0 0 320 340" className="w-full max-w-sm" aria-hidden focusable="false">
      {nodes.slice(0, -1).map((n, i) => (
        <path key={i} d={`M${n.x + 20} ${n.y + 36} V${nodes[i + 1]!.y}`} stroke="var(--border-strong)" strokeWidth="2" strokeDasharray={i === 2 ? "4 4" : undefined} fill="none" />
      ))}
      {nodes.map((n, i) => (
        <g key={n.label}>
          <rect x={n.x} y={n.y} width="272" height="36" rx="8" fill="var(--surface)" stroke="var(--border)" />
          <rect x={n.x} y={n.y} width="4" height="36" rx="2" fill={n.tone} />
          <text x={n.x + 18} y={n.y + 23} fontSize="13" fill="var(--text)" fontFamily="var(--font-geist-mono)">{n.label}</text>
          <text x={n.x + 256} y={n.y + 23} fontSize="12" textAnchor="end" fill="var(--text-subtle)" fontFamily="var(--font-geist-mono)">{["202", "ok", "timeout ×3", "ok"][i]}</text>
        </g>
      ))}
    </svg>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Link href="/sign-in" className="w-fit rounded-sm" aria-label="Brightrail sign in">
          <Logo />
        </Link>
        <main id="main" className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
        <div className="flex flex-col gap-2 text-sm text-fg-subtle">
          <p>Your data is stored in your Brightrail workspace and is never shared across workspaces.</p>
          <p className="flex flex-wrap gap-x-4">
            <Link href="/privacy" className="hover:text-fg hover:underline">Privacy</Link>
            <Link href="/terms" className="hover:text-fg hover:underline">Terms</Link>          </p>
        </div>
      </div>
      <aside className="relative hidden flex-col justify-between overflow-hidden border-l border-border bg-surface-sunken p-12 lg:flex" aria-label="About Brightrail">
        <div className="max-w-md">
          <p className="text-sm font-medium tracking-wide text-primary uppercase">Durable automation</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance">Automate the process. Keep control when an integration fails.</h2>
          <p className="mt-3 text-md text-fg-muted">Every run is versioned and inspectable. Failures are retried safely, and the AI assistant only recommends: people approve.</p>
        </div>
        <FlowIllustration />
        <ul className="grid grid-cols-3 gap-4 text-sm text-fg-muted">
          <li><span className="block text-lg font-semibold text-fg">Pinned</span>Runs reference the exact version</li>
          <li><span className="block text-lg font-semibold text-fg">Idempotent</span>Retries reuse the same key</li>
          <li><span className="block text-lg font-semibold text-fg">Audited</span>Every decision is attributable</li>
        </ul>
      </aside>
    </div>
  );
}
