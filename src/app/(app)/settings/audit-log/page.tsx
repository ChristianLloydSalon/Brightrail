import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditLogView } from "@/features/admin/audit-log";
export const metadata: Metadata = { title: "Audit log" };
export default function Page() { return <Suspense><AuditLogView /></Suspense>; }
