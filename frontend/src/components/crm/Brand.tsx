"use client";
/* Brand identity of a record: a compact chip (icon + brand name) from the record's company. Logos: BrandMark.tsx. */
import { BrandIcon } from "@/components/crm/BrandMark";
import { useMaster } from "@/components/providers";
import { brandOfCompany } from "@/lib/brand";
import { cn } from "@/lib/utils";

export { BrandIcon, BrandLogo } from "@/components/crm/BrandMark";

export function BrandChip({ companyId, size = "md", className }: { companyId: string | null | undefined; size?: "sm" | "md"; className?: string }) {
  const companies = useMaster("companies");
  const company = companies.data?.find((c) => c.id === companyId);
  if (!company) return null;
  const brand = brandOfCompany(company);
  const label = brand?.name ?? String(company.brand ?? company.name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface font-medium text-fg",
        size === "md" ? "h-7 pl-1 pr-2.5 text-sm" : "h-6 pl-0.5 pr-2 text-xs",
        className,
      )}
    >
      {brand ? <BrandIcon brand={brand} size={size === "md" ? 24 : 20} decorative className="rounded-full" /> : null}
      {label}
    </span>
  );
}
