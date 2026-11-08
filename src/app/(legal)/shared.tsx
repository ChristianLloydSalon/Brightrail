import Link from "next/link";

export const OPERATOR = "Christian Salon";
export const CONTACT_EMAIL = "christianlloyd.b.salon@gmail.com";
export const EFFECTIVE_DATE = "8 November 2026";

export const LEGAL_DOCS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
] as const;

export function Mail() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

/** Shared frame for the legal pages: title, effective date and readable typography for the body. */
export function LegalDoc({ title, intro, children }: { title: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <article className="text-md leading-relaxed text-fg-muted [&_a]:font-medium [&_a]:text-link [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:scroll-mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-fg [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-fg [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_strong]:font-semibold [&_strong]:text-fg [&_table]:mt-4 [&_table]:w-full [&_table]:text-sm [&_td]:border-t [&_td]:border-border [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-semibold [&_th]:text-fg [&_ul]:list-disc [&_ul]:pl-6">
      <h1 className="text-3xl font-semibold tracking-tight text-balance text-fg">{title}</h1>
      <p className="mt-2 text-sm text-fg-subtle">Effective {EFFECTIVE_DATE}</p>
      <div className="mt-6 text-lg text-fg">{intro}</div>
      {children}
    </article>
  );
}

export function LegalNav({ current }: { current?: string }) {
  return (
    <nav aria-label="Legal documents">
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {LEGAL_DOCS.map((d) => (
          <li key={d.href}>
            <Link href={d.href} aria-current={current === d.href ? "page" : undefined} className="text-fg-muted hover:text-fg hover:underline aria-[current=page]:font-medium aria-[current=page]:text-fg">
              {d.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
