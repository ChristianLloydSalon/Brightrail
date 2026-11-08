import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { headers } from "next/headers";
import { Providers } from "@/components/providers/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Brightrail", template: "%s · Brightrail" },
  description: "Workflow automation with durable execution, run inspection and AI-assisted recovery.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
};

/** Applies the saved theme before paint so there is no light/dark flash. */
const themeScript = `(function(){try{var s=JSON.parse(localStorage.getItem('brightrail-prefs')||localStorage.getItem('flowforge-prefs')||'{}').state||{};var t=s.theme||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The proxy sets a per-request nonce; the strict CSP blocks any inline script without it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only z-[100] rounded-md bg-surface px-3 py-2 text-fg shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
