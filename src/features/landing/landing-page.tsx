import { ArrowRight, Globe, Mail, MessageSquare, MessagesSquare, NotebookText, Send, Sheet, Table2, Users } from "lucide-react";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BuildFragment, InspectFragment, RecoverFragment, RunFragment, TriggerFragment } from "./fragments";
import { RunRail } from "./run-rail";

export const REPO_URL = "https://github.com/ChristianLloydSalon/Brightrail";
const BUILDER = "Christian Salon";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4", className)} aria-hidden focusable="false" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const container = "mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8";

/*
 * From "How it works" to the last stop, the page is one rail line. Every section shares the same
 * rail column, so the line's x position never moves; each section draws its own length of it.
 */
const railGrid = "grid grid-cols-[40px_1fr] gap-x-4 sm:grid-cols-[56px_1fr] sm:gap-x-6";
const railLine = "pointer-events-none absolute left-4 w-2 sm:left-6";
const railStop = "relative mt-1 size-10 shrink-0 rounded-full border-[7px] shadow-sm sm:size-14 sm:border-8";

function Header({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="relative z-10">
      <div className={cn(container, "flex h-16 items-center justify-between gap-4 md:h-20")}>
        <Link href="/" aria-label="Brightrail home" className="rounded-sm">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <ul className="mr-2 hidden items-center gap-1 lg:flex">
            {[
              ["#how-it-works", "How it works"],
              ["#integrations", "Integrations"],
              ["#under-the-hood", "Under the hood"],
            ].map(([href, label]) => (
              <li key={href}>
                <a href={href} className="rounded-md px-3 py-2 text-base text-fg-muted transition-colors hover:text-fg">
                  {label}
                </a>
              </li>
            ))}
            <li>
              <a href={REPO_URL} className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-base text-fg-muted transition-colors hover:text-fg">
                <GitHubMark /> GitHub
              </a>
            </li>
          </ul>
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up">Start free</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="hero-title" className={cn(container, "pt-8 pb-20 md:pt-12 md:pb-28")}>
      <h1 id="hero-title" className="max-w-[16ch] text-[clamp(2.5rem,7.2vw,5.5rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance text-fg">
        Automations that <span className="text-primary">stay on the rails</span> when an API doesn&rsquo;t.
      </h1>
      <p className="mt-6 max-w-[60ch] text-lg text-fg-muted md:text-xl md:leading-8">
        Draw the workflow, connect your services, and watch every step run. When a step fails, Brightrail retries it safely, explains what went wrong,
        and waits for a person to approve the fix.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href={signedIn ? "/dashboard" : "/sign-up"}>
            {signedIn ? "Go to dashboard" : "Start building free"} <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href="#how-it-works">See how a run recovers</a>
        </Button>
      </div>
      <RunRail />
    </section>
  );
}

const FAILURES = [
  { without: "An API times out halfway through a job.", with: "Durable steps pick up where they stopped, even across a redeploy." },
  { without: "A retry sends the welcome email twice.", with: "Every attempt reuses its idempotency key, so a side effect happens once." },
  { without: "Nobody can say what the provider returned.", with: "Each attempt is stored with its error class and redacted input and output." },
];

function Problem() {
  return (
    <section aria-labelledby="problem-title" className="border-y border-border bg-surface">
      <div className={cn(container, "grid gap-10 py-20 md:py-28 lg:grid-cols-[5fr_7fr] lg:gap-16")}>
        <div>
          <h2 id="problem-title" className="text-[clamp(2rem,4vw,3rem)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-fg">
            Most automations fail quietly.
          </h2>
          <p className="mt-5 max-w-[48ch] text-lg text-fg-muted">
            Glue scripts and naive retries hide the moment things go wrong. Brightrail is built around the run, so that moment is recorded, safe to retry and easy to read.
          </p>
        </div>
        <table className="w-full text-left">
          <caption className="sr-only">What usually happens, and what Brightrail does instead</caption>
          <thead>
            <tr className="text-sm text-fg-subtle">
              <th scope="col" className="w-1/2 pr-6 pb-3 font-medium">Usually</th>
              <th scope="col" className="pb-3 font-medium text-primary">With Brightrail</th>
            </tr>
          </thead>
          <tbody>
            {FAILURES.map((f) => (
              <tr key={f.without} className="border-t border-border align-top">
                <td className="py-5 pr-6 text-md text-fg-muted">{f.without}</td>
                <td className="py-5 text-md font-medium text-fg">{f.with}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const STOPS = [
  {
    name: "Build",
    lead: "Draw it on a canvas.",
    body: "Nine step types: triggers, HTTP requests, connector actions, conditions, loops, formulas, delays, data transforms and error handlers. About 35 validation rules explain every problem in plain language before you publish, and on a phone the builder switches to an outline view.",
    fragment: <BuildFragment />,
  },
  {
    name: "Trigger",
    lead: "Start it however the work arrives.",
    body: "Run it by hand, call the REST API with a scoped key, accept signed webhooks or secret-link form posts, or put it on a cron schedule in any time zone.",
    fragment: <TriggerFragment />,
  },
  {
    name: "Run",
    lead: "Run it on a durable engine.",
    body: "Each step is checkpointed, so a redeploy mid-run resumes without repeating finished work. Retries back off and reuse the same idempotency key. Delays of minutes or days use no compute while they wait, and every run stays pinned to the version it started on.",
    fragment: <RunFragment />,
  },
  {
    name: "Inspect",
    lead: "See every attempt.",
    body: "The run inspector shows each step, every attempt with its error class and idempotency key, redacted input and output, and structured logs. It updates live while the run is in progress. Retry one step, cancel, or re-run with the same input.",
    fragment: <InspectFragment />,
  },
  {
    name: "Recover",
    lead: "Recover with a person in charge.",
    body: "An AI assistant reads sanitized evidence, explains the likely root cause and recommends an action from a fixed catalogue. Nothing runs until an Operator or Admin approves it, and recommendations expire if nobody does.",
    fragment: <RecoverFragment />,
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-6">
      <div className={cn(container, "pt-20 md:pt-28")}>
        <div className={railGrid}>
          <span aria-hidden />
          <h2 id="how-title" className="max-w-[22ch] text-[clamp(2rem,4vw,3rem)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-fg">
            One line from first draft to recovered run.
          </h2>
        </div>
        <ol className="mt-14 md:mt-20">
          {STOPS.map((s, i) => {
            const last = i === STOPS.length - 1;
            return (
              <li key={s.name} className={cn("relative", railGrid)}>
                <span aria-hidden className={cn(railLine, "top-4 h-full rounded-t-full bg-primary")} />
                <span aria-hidden className={cn(railStop, "border-primary bg-background")} />
                <div className={cn("grid gap-8 lg:grid-cols-2 lg:gap-14", last ? "pb-20 md:pb-28" : "pb-16 md:pb-24")}>
                  <div className="pt-1 sm:pt-3">
                    <h3 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{s.name}</h3>
                    <p className="mt-2 text-xl font-medium text-primary">{s.lead}</p>
                    <p className="mt-4 max-w-[58ch] text-md text-fg-muted">{s.body}</p>
                  </div>
                  <div className="min-w-0 lg:pt-3">{s.fragment}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

const CONNECTORS = [
  { name: "Any HTTPS API", icon: Globe },
  { name: "Slack", icon: MessageSquare },
  { name: "Discord", icon: MessagesSquare },
  { name: "Microsoft Teams", icon: Users },
  { name: "Telegram", icon: Send },
  { name: "Resend email", icon: Mail },
  { name: "Google Sheets", icon: Sheet },
  { name: "Notion", icon: NotebookText },
  { name: "Airtable", icon: Table2 },
];

function Integrations() {
  return (
    <section id="integrations" aria-labelledby="integrations-title" className="scroll-mt-6 border-t border-border bg-surface">
      <div className={container}>
        <div className={cn("relative py-20 md:py-28", railGrid)}>
          <span aria-hidden className={cn(railLine, "inset-y-0 bg-primary")} />
          <span aria-hidden className={cn(railStop, "border-primary bg-surface")} />
          <div className="min-w-0">
            <div className="grid gap-6 lg:grid-cols-[5fr_7fr] lg:gap-16">
              <h2 id="integrations-title" className="text-[clamp(2rem,4vw,3rem)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-fg">
                Connects to the tools your team already uses.
              </h2>
              <p className="max-w-[56ch] text-lg text-fg-muted lg:pt-2">
                First-party connectors for chat, email and data, plus an HTTP step for any public API. Outbound calls are checked and pinned to a public address, so a
                workflow can&rsquo;t be pointed at your internal network.
              </p>
            </div>
            <ul className="mt-10 flex flex-wrap gap-2 sm:mt-12 sm:gap-3">
              {CONNECTORS.map((c) => (
                <li key={c.name} className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-background py-1.5 pr-3 pl-1.5 text-base font-medium text-fg sm:gap-2.5 sm:py-2 sm:pr-4 sm:pl-2 sm:text-md">
                  <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-secondary-soft text-secondary sm:size-8">
                    <c.icon className="size-4" />
                  </span>
                  {c.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

const FACTS = [
  { term: "Encrypted credentials", detail: "AES-256-GCM, in tables no client can read. The app only ever shows a short hint." },
  { term: "Isolated workspaces", detail: "Postgres row-level security keeps each workspace’s data to its own members." },
  { term: "Roles and audit log", detail: "Owner, Admin, Editor, Operator and Viewer, with an append-only record of who did what." },
  { term: "Immutable versions", detail: "Every publish is checksummed. A run never changes version halfway through." },
  { term: "Safe outbound calls", detail: "SSRF checks and DNS pinning on every HTTP step and connector request." },
  { term: "Secure sign-in", detail: "Email, Google or GitHub, with optional TOTP two-factor authentication." },
];

function UnderTheHood() {
  return (
    <section id="under-the-hood" aria-labelledby="hood-title" className="scroll-mt-6 bg-primary text-primary-fg">
      <div className={container}>
        <div className={cn("relative py-20 md:py-28", railGrid)}>
          <span aria-hidden className={cn(railLine, "inset-y-0 bg-primary-fg")} />
          <span aria-hidden className={cn(railStop, "border-primary-fg bg-primary shadow-none")} />
          <div className="min-w-0">
            <h2 id="hood-title" className="max-w-[20ch] text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance">
              Built like infrastructure, because it runs like it.
            </h2>
            <dl className="mt-14 grid gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
              {FACTS.map((f) => (
                <div key={f.term} className="border-t border-[color-mix(in_oklab,var(--primary-fg)_35%,transparent)] py-6">
                  <dt className="text-lg font-semibold">{f.term}</dt>
                  <dd className="mt-2 text-md text-[color-mix(in_oklab,var(--primary-fg)_88%,var(--primary))]">{f.detail}</dd>
                </div>
              ))}
            </dl>
            <a
              href={REPO_URL}
              className="mt-10 inline-flex min-h-11 items-center gap-2 rounded-md bg-primary-fg px-5 py-2.5 text-left text-md font-medium text-primary transition-opacity hover:opacity-90 focus-visible:outline-primary-fg"
            >
              <GitHubMark /> Read the architecture on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Terminus({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="start-title" className={container}>
      <div className={cn("relative overflow-hidden py-20 md:py-32", railGrid)}>
        {/* The line's last stop: the rail arrives from above and ends in a filled terminus ring. */}
        <span aria-hidden className="relative mt-1 size-10 sm:size-14">
          <span className={cn(railLine, "bottom-1/2 h-[60rem] bg-primary")} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full border-[7px] border-primary bg-background shadow-sm sm:border-8">
            <span className="size-3 rounded-full bg-primary sm:size-4" />
          </span>
        </span>
        <div className="min-w-0">
          <h2 id="start-title" className="text-[clamp(2.25rem,5vw,4rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance text-fg">
            Last stop: your first workflow.
          </h2>
          <p className="mt-4 max-w-[52ch] text-lg text-fg-muted">Free to use. Start from a template or a blank canvas, run it, and see every step it took.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={signedIn ? "/dashboard" : "/sign-up"}>
                {signedIn ? "Go to dashboard" : "Start building free"} <ArrowRight aria-hidden />
              </Link>
            </Button>
            {!signedIn && (
              <Button asChild size="lg" variant="outline">
                <Link href="/sign-in">Sign in</Link>
              </Button>
            )}
          </div>
          <p className="mt-8 max-w-[60ch] text-sm text-fg-subtle">
            Brightrail is a portfolio project. It&rsquo;s free, has no uptime guarantee, and data may be reset, so please don&rsquo;t connect production systems. See the{" "}
            <Link href="/terms" className="font-medium text-link underline underline-offset-2 hover:no-underline">Terms</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className={cn(container, "flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between")}>
        <div className="flex items-center gap-3">
          <LogoMark className="size-6" />
          <p className="text-sm text-fg-muted">
            Built by <span className="font-medium text-fg">{BUILDER}</span>
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <li><a href={REPO_URL} className="text-fg-muted hover:text-fg hover:underline">Source on GitHub</a></li>
            <li><Link href="/privacy" className="text-fg-muted hover:text-fg hover:underline">Privacy Policy</Link></li>
            <li><Link href="/terms" className="text-fg-muted hover:text-fg hover:underline">Terms of Service</Link></li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <Header signedIn={signedIn} />
      <main id="main">
        <Hero signedIn={signedIn} />
        <Problem />
        <HowItWorks />
        <Integrations />
        <UnderTheHood />
        <Terminus signedIn={signedIn} />
      </main>
      <Footer />
    </div>
  );
}
