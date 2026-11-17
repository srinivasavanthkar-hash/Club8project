import { Suspense } from "react";
import { BrandLogo } from "@/components/crm/BrandMark";
import { BRANDS } from "@/lib/brand";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

/* Both brands at equal visual weight on a light panel (logos are only ever placed on white / light surfaces).
 * Clear space around each logo is at least the height of the "8". */
export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-bg lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section aria-label="Club8 Holidays and K8" className="hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-center lg:px-14 lg:py-12">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-14">
          <BrandLogo brand={BRANDS.club8} width={240} priority />
          <div aria-hidden className="h-0.5 w-24 rounded-full bg-accent" />
          <BrandLogo brand={BRANDS.k8} width={240} priority />
        </div>
        <p className="mt-16 text-center text-sm text-fg-muted">Staff CRM for Club8 Holidays and K8</p>
      </section>
      <section className="flex flex-col items-center justify-center gap-8 px-4 py-10 sm:px-8">
        <div className="flex w-full max-w-sm items-center justify-center gap-8 rounded-lg bg-surface px-6 py-6 lg:hidden">
          <BrandLogo brand={BRANDS.club8} width={140} priority />
          <BrandLogo brand={BRANDS.k8} width={140} priority />
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="text-center text-xs text-fg-subtle">Authorised staff only. Activity is logged.</p>
      </section>
    </main>
  );
}
