import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

/* The theme is REPLACED, not extended, for colours, font sizes, radii and shadows: only design tokens exist
 * (src/app/globals.css, docs/DESIGN_SYSTEM.md). `npm run check:tokens` rejects arbitrary values in components. */
const c = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      bg: c("bg"),
      surface: { DEFAULT: c("surface"), raised: c("surface-raised"), sunken: c("surface-sunken") },
      border: { DEFAULT: c("border"), strong: c("border-strong") },
      fg: { DEFAULT: c("text"), muted: c("text-muted"), subtle: c("text-subtle"), "on-fill": c("on-fill") },
      // semantic brand colours only; the theme (<html data-brand>) decides Club8 or K8 values
      primary: { DEFAULT: c("brand-primary"), hover: c("brand-primary-hover"), subtle: c("brand-primary-subtle"), border: c("brand-primary-border") },
      accent: { DEFAULT: c("brand-accent"), subtle: c("brand-accent-subtle"), text: c("brand-accent-text") },
      secondary: c("brand-secondary"),
      success: { DEFAULT: c("success"), subtle: c("success-subtle") },
      warning: { DEFAULT: c("warning"), subtle: c("warning-subtle"), strong: c("warning-strong") },
      danger: { DEFAULT: c("danger"), subtle: c("danger-subtle") },
      info: { DEFAULT: c("info"), subtle: c("info-subtle") },
      season: { red: c("season-red"), "red-bg": c("season-red-bg"), blue: c("season-blue"), "blue-bg": c("season-blue-bg") },
    },
    fontSize: {
      xs: ["var(--font-size-xs)", { lineHeight: "1rem" }],
      sm: ["var(--font-size-sm)", { lineHeight: "1.125rem" }],
      base: ["var(--font-size-base)", { lineHeight: "1.25rem" }],
      md: ["var(--font-size-md)", { lineHeight: "1.5rem" }],
      lg: ["var(--font-size-lg)", { lineHeight: "1.625rem" }],
      xl: ["var(--font-size-xl)", { lineHeight: "1.75rem" }],
      "2xl": ["var(--font-size-2xl)", { lineHeight: "2rem" }],
      "3xl": ["var(--font-size-3xl)", { lineHeight: "2.375rem" }],
    },
    fontWeight: { normal: "400", medium: "500", semibold: "600", bold: "700" },
    borderRadius: { none: "0", sm: "4px", md: "var(--radius-control)", lg: "var(--radius-card)", full: "9999px" },
    boxShadow: {
      none: "none",
      popover: "0 8px 24px -6px hsl(var(--shadow-color) / 0.18), 0 2px 6px -2px hsl(var(--shadow-color) / 0.10)",
      dialog: "0 24px 48px -12px hsl(var(--shadow-color) / 0.30)",
      sticky: "0 4px 12px -6px hsl(var(--shadow-color) / 0.18)",
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      spacing: { sidebar: "var(--sidebar-width)", topbar: "var(--topbar-height)", bar: "3px" },
      maxWidth: { page: "100rem", drawer: "85vw" },
      transitionDuration: { DEFAULT: "150ms" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-left": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        "slide-in-right": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "toast-in": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        shimmer: { "0%": { opacity: "1" }, "50%": { opacity: "0.55" }, "100%": { opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "slide-in-left": "slide-in-left 200ms ease-out",
        "slide-in-right": "slide-in-right 200ms ease-out",
        "toast-in": "toast-in 180ms ease-out",
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      // touch devices: enlarge hit areas to 44x44
      addVariant("touch", "@media (pointer: coarse)");
    }),
  ],
} satisfies Config;
