import { Blocks, CalendarClock, Database, FileText, Globe, MessageSquare, NotebookText, Package, Mail, Send, Sheet, Table2, Users, Wallet, Webhook } from "lucide-react";

const MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  int_http: Globe, int_webhook: Webhook, int_ledgerly: Wallet, int_stockroom: Package, int_invoicely: FileText, int_relaymail: Mail,
  int_chatline: MessageSquare, int_pipeline: Users, int_sheetstack: Sheet, int_postgres: Database, int_schedule: CalendarClock, int_sheets: Sheet, int_telegram: Send, int_teams: Users, int_notion: NotebookText, int_airtable: Table2,
};

/** Generic glyph per connector. Sandbox vendors are fictional, so no third-party logos are used. */
export function IntegrationLogo({ id, name, size = "md" }: { id: string; name: string; size?: "md" | "lg" }) {
  const Icon = MAP[id] ?? Blocks;
  return (
    <span className={size === "lg" ? "flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-sunken text-secondary" : "flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-sunken text-secondary"} aria-hidden title={name}>
      <Icon className={size === "lg" ? "size-6" : "size-5"} />
    </span>
  );
}
