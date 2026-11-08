import type { Metadata } from "next";
import { Suspense } from "react";
import { MembersView } from "@/features/admin/members";
export const metadata: Metadata = { title: "Members" };
export default function Page() { return <Suspense><MembersView /></Suspense>; }
