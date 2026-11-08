import type { Metadata } from "next";
import { WorkspaceSettingsView } from "@/features/admin/workspace-settings";
export const metadata: Metadata = { title: "Workspace settings" };
export default function Page() { return <WorkspaceSettingsView />; }
