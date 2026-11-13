import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { DEFAULT_BRAND } from "@/lib/brand";

// Inter: legible at 13-14px, tabular figures, and the ₹ sign (U+20B9, in the latin-ext subset).
const sans = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap" });
// Monospace only for IDs and references (membership / receipt / reservation numbers, audit hash).
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500", "600"] });

const { appName, icons } = DEFAULT_BRAND;

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  applicationName: appName,
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: icons.ico, sizes: "any" },
      { url: icons.png32, sizes: "32x32", type: "image/png" },
      { url: icons.png16, sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: icons.apple180, sizes: "180x180", type: "image/png" }],
  },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: DEFAULT_BRAND.themeColor };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" data-brand={DEFAULT_BRAND.id} className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
