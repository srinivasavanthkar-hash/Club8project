"use client";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { BrandIcon } from "@/components/crm/BrandMark";
import { Button, buttonClasses } from "@/components/ui";

/** Unexpected error boundary: plain language, retry, never a stack trace. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <BrandIcon size={48} decorative className="opacity-50" />
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-base text-fg-muted">This page could not be shown. Try again; if it keeps happening, contact support.</p>
      <div className="flex gap-2">
        <Button onClick={reset}><RefreshCw aria-hidden />Try again</Button>
        <Link href="/" className={buttonClasses({ variant: "outline" })}>Go to the dashboard</Link>
      </div>
    </main>
  );
}
