"use client";
/* Logo and icon images (no data hooks, so the ui primitives can use them). Files are used exactly as supplied
 * (next/image, proportional scaling only), always on white or very light surfaces. Rules: DESIGN_SYSTEM.md "Brand". */
import Image from "next/image";
import { type Brand, DEFAULT_BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Full logo at a given display width (px). Padded files are framed to their artwork without altering them. */
export function BrandLogo({ brand = DEFAULT_BRAND, width, priority, className }: { brand?: Brand; width: number; priority?: boolean; className?: string }) {
  const { logo } = brand;
  const f = logo.frame;
  if (!f) {
    return (
      <Image src={logo.src} alt={brand.alt} width={logo.width} height={logo.height} priority={priority}
        sizes={`${width}px`} className={cn("h-auto max-w-full", className)} style={{ width }} />
    );
  }
  const aw = f.x1 - f.x0;
  const ah = f.y1 - f.y0;
  return (
    <div className={cn("max-w-full overflow-hidden", className)} style={{ width, aspectRatio: `${aw} / ${ah}` }}>
      <Image
        src={logo.src} alt={brand.alt} width={logo.width} height={logo.height} priority={priority}
        sizes={`${Math.ceil((width * logo.width) / aw)}px`}
        className="h-auto max-w-none"
        style={{ width: `${(logo.width / aw) * 100}%`, marginLeft: `-${(f.x0 / aw) * 100}%`, marginTop: `-${(f.y0 / aw) * 100}%` }}
      />
    </div>
  );
}

/** Brand icon (provisional crops of the client's artwork). decorative = sits next to the brand name. */
export function BrandIcon({ brand = DEFAULT_BRAND, size, decorative, className }: { brand?: Brand; size: number; decorative?: boolean; className?: string }) {
  return (
    <Image src={brand.icon.src} alt={decorative ? "" : brand.alt} width={size} height={size} sizes={`${size}px`}
      className={cn("shrink-0", className)} style={{ width: size, height: size }} />
  );
}
