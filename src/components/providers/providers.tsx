"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/menu";
import { usePrefs } from "@/lib/prefs";
import { AnnouncerProvider } from "./announcer";

function ThemeSync() {
  const theme = usePrefs((s) => s.theme);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: true, staleTime: 10_000 }, mutations: { retry: 0 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <AnnouncerProvider>
        <TooltipProvider delayDuration={300}>
          <ThemeSync />
          {children}
          <Toaster position="bottom-right" closeButton toastOptions={{ classNames: { toast: "!bg-surface-raised !text-fg !border-border !shadow-lg", description: "!text-fg-muted", actionButton: "!bg-primary !text-primary-fg" } }} />
        </TooltipProvider>
      </AnnouncerProvider>
    </QueryClientProvider>
  );
}
