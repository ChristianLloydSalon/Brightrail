import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { LegalNav } from "./shared";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" className="w-fit rounded-sm" aria-label="Brightrail home">
            <Logo />
          </Link>
          <LegalNav />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        {children}
      </main>
    </div>
  );
}
