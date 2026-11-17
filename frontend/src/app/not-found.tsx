"use client";
import Link from "next/link";
import { usePageTitle } from "@/components/crm/Display";
import { BrandIcon } from "@/components/crm/BrandMark";
import { buttonClasses } from "@/components/ui";

export default function NotFound() {
  usePageTitle("Page not found");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
      <BrandIcon size={48} decorative className="opacity-50" />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-base text-fg-muted">The page may have moved, or the link is incomplete. Search for the member or lead from the dashboard.</p>
      <Link href="/" className={buttonClasses()}>Go to the dashboard</Link>
    </main>
  );
}
