import { BrandLogo } from "@/components/crm/BrandMark";
import { DEFAULT_BRAND } from "@/lib/brand";

/* Account-security steps (change password, set up 2FA). No navigation: while a step is forced, nothing else in the
 * app is reachable (the API refuses it too), so the page offers only the step itself and "Sign out". */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-bg px-4 py-10 sm:py-14">
      <BrandLogo brand={DEFAULT_BRAND} width={150} priority />
      {children}
      <p className="text-center text-xs text-fg-subtle">Authorised staff only. Activity is logged.</p>
    </main>
  );
}
