/** Brands served by the CRM (docs/BRAND_PROMPT.md). Logo files live in public/brand/ exactly as supplied.
 * The app shell uses ONE theme: the deployment's default brand (NEXT_PUBLIC_DEFAULT_BRAND, set at build time).
 * Records show their own brand as a compact chip; documents use the record's company branding. */

export type BrandId = "club8" | "k8";

type Img = { src: string; width: number; height: number };
/** Opaque artwork area of a logo file with extra transparent padding (framed in CSS; the file is never edited). */
export type Frame = { x0: number; y0: number; x1: number; y1: number };

export type Brand = {
  id: BrandId;
  name: string; // brand name as shown on chips
  appName: string; // "Club8 CRM": browser tab titles
  alt: string; // logo alt text
  logo: Img & { frame?: Frame };
  icon: Img; // provisional icon (docs/DESIGN_DECISIONS.md)
  icons: { ico: string; png16: string; png32: string; apple180: string; png192: string; png512: string };
  themeColor: string; // = --brand-primary, for the browser UI (must be a literal)
};

const files = (id: BrandId) => ({
  ico: `/brand/${id}/${id}-favicon.ico`,
  png16: `/brand/${id}/${id}-icon-16.png`,
  png32: `/brand/${id}/${id}-icon-32.png`,
  apple180: `/brand/${id}/${id}-icon-180.png`,
  png192: `/brand/${id}/${id}-icon-192.png`,
  png512: `/brand/${id}/${id}-icon-512.png`,
});

export const BRANDS: Record<BrandId, Brand> = {
  club8: {
    id: "club8",
    name: "Club8 Holidays",
    appName: "Club8 CRM",
    alt: "Club8 Holidays",
    logo: { src: "/brand/club8/club8-logo.png", width: 854, height: 629 },
    icon: { src: "/brand/club8/club8-icon-192.png", width: 192, height: 192 },
    icons: files("club8"),
    themeColor: "#393186", // design-tokens-allow: browser UI colour must be a literal (= --c8-indigo)
  },
  k8: {
    id: "k8",
    name: "K8",
    appName: "K8 CRM",
    alt: "K8 Klub Eight Asia Ventures",
    // The supplied file is 1053x938 with transparent padding below and right of the artwork (26..922 x 28..512).
    logo: { src: "/brand/k8/k8-logo.png", width: 1053, height: 938, frame: { x0: 26, y0: 28, x1: 922, y1: 512 } },
    icon: { src: "/brand/k8/k8-icon-192.png", width: 192, height: 192 },
    icons: files("k8"),
    themeColor: "#172040", // design-tokens-allow: browser UI colour must be a literal (= --k8-navy)
  },
};

export function resolveBrand(value: string | undefined | null): BrandId {
  return value?.toLowerCase() === "k8" ? "k8" : "club8";
}

/** The app theme. NEXT_PUBLIC_* is inlined at build time (Dockerfile build arg). */
export const DEFAULT_BRAND: Brand = BRANDS[resolveBrand(process.env.NEXT_PUBLIC_DEFAULT_BRAND)];

/** Brand of a company master-data row: from its logo_path ("k8/k8-logo.png"), else its code. */
export function brandOfCompany(c: { code?: unknown; logo_path?: unknown } | null | undefined): Brand | null {
  if (!c) return null;
  const fromLogo = typeof c.logo_path === "string" ? c.logo_path.split("/")[0] : "";
  const key = fromLogo || (typeof c.code === "string" ? c.code.toLowerCase() : "");
  return key === "club8" || key === "k8" ? BRANDS[key] : null;
}
