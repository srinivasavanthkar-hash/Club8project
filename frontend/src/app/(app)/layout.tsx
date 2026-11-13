import { AppShell } from "@/components/crm/AppShell";

// Read CRM_ENV per request: the same image is promoted dev -> staging -> prod, so it cannot be baked in at build.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell env={process.env.CRM_ENV ?? ""}>{children}</AppShell>;
}
