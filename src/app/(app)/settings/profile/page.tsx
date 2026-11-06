import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileView } from "@/features/admin/profile";
export const metadata: Metadata = { title: "Profile settings" };
export default function Page() { return <Suspense><ProfileView /></Suspense>; }
