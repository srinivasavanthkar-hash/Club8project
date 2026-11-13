# Brand Prompt: Add the Club8 and K8 Logos and Brand Colours to the CRM

## 0. Context and rules

The CRM was built from `docs/BUILD_PROMPT.md` and styled from `docs/UI_STYLING_PROMPT.md`. It serves **two brands**:
- **Club8 Holidays**, promoted by Multiple Sales and Marketing LLP.
- **K8 — Klub Eight Asia Ventures.**

The client has now supplied both logos. This prompt adds them to the app and **replaces the approximate brand colours in `UI_STYLING_PROMPT.md` §2.1–2.2 with the exact values below.** Where the two prompts differ, this one wins.

Rules:
- **Use the logo files exactly as supplied.** Never redraw, trace, recolour, stretch, rotate, add effects (shadows, outlines, glows) to, or rebuild the logos in code/SVG. Scale proportionally only.
- Change only branding: logos, favicons, brand tokens, the login screen, the app shell header and PDF templates. Do not change business logic, APIs, permissions or page layouts beyond what is needed to place the logos.
- All existing tests, including the Section 14 demo, must still pass. Update the visual-regression baselines afterwards and note this in the summary.

## 1. Files supplied

The files are in `brand-assets/` at the repo root. Move them into `public/brand/` with this structure:

```
public/brand/
  club8/
    club8-logo.png          # full logo, transparent background (853×625)
    club8-icon-512.png      # icon: the orange "8" from the logo (provisional)
    club8-icon-192.png
    club8-icon-180.png      # apple-touch-icon
    club8-icon-32.png
    club8-icon-16.png
    club8-favicon.ico       # 16/32/48
  k8/
    k8-logo.png             # full logo, transparent background (950×530)
    k8-icon-512.png         # icon: the full K8 monogram (provisional)
    k8-icon-192.png
    k8-icon-180.png
    k8-icon-32.png
    k8-icon-16.png
    k8-favicon.ico
```

About these files:
- They were prepared from the client's JPG logos. The white background was made transparent and the files trimmed; nothing else was altered.
- **They work on white and light backgrounds only.** The Club8 "HOLIDAYS" text and the K8 "KLUB EIGHT ASIA VENTURES" text are dark navy/indigo and become unreadable on dark backgrounds. **Never place either logo on a dark, coloured or photographic background.**
- The icons are **provisional** crops of the client's own artwork. Mark them as such in `docs/DESIGN_DECISIONS.md`, and replace them when the client supplies official icons or SVG logos (see Section 7).
- Use `next/image` for every logo, with explicit `width`/`height`, meaningful `alt` text ("Club8 Holidays" / "K8 Klub Eight Asia Ventures"), and `priority` on the login page.

## 2. Exact brand colours (sampled from the supplied logos)

### Club8 Holidays

| Token | Hex | Where it appears in the logo | Contrast on white |
|---|---|---|---|
| `--c8-indigo` | `#393186` | "HOLIDAYS" and the dark end of the "Club" gradient | 10.7:1 ✅ |
| `--c8-blue` | `#1E5AA8` | Middle of the "Club" gradient | 6.8:1 ✅ |
| `--c8-cyan` | `#029ADB` | Light end of the "Club" gradient | 3.2:1 (large text/icons only) |
| `--c8-orange` | `#EF7F1B` | The "8" and the sun | 2.7:1 ❌ not for text |
| `--c8-orange-text` | `#B35F14` | Darkened orange for text that must be orange | 4.6:1 ✅ |

### K8 — Klub Eight Asia Ventures

| Token | Hex | Where it appears in the logo | Contrast on white |
|---|---|---|---|
| `--k8-navy` | `#172040` | "KLUB EIGHT ASIA VENTURES" | 15.9:1 ✅ |
| `--k8-gold` | `#BC9C23` | The "K8" letters | 2.65:1 ❌ not for text |
| `--k8-gold-text` | `#8B7319` | Darkened gold for text that must be gold | 4.6:1 ✅ |

Re-verify these values against the files with a colour picker, and record final values and contrast ratios in `docs/DESIGN_SYSTEM.md`. Generate the `-hover`, `-subtle` (tinted background) and `-border` variants from the base values and check each text/background pair for WCAG AA.

### Mapping to the app's semantic tokens

| Semantic token (from UI_STYLING_PROMPT) | Club8 theme (default) | K8 theme |
|---|---|---|
| `--brand-primary` (primary buttons, links, active nav text, focus ring) | `--c8-indigo` | `--k8-navy` |
| `--brand-accent` (active-nav indicator bar, highlights, small badges, chart accent) | `--c8-orange` | `--k8-gold` |
| `--brand-accent-text` (when accent-coloured text is genuinely needed) | `--c8-orange-text` | `--k8-gold-text` |
| `--brand-secondary` (secondary charts, info highlights) | `--c8-blue` | a muted navy tint |

Rename `--brand-navy` / `--brand-orange` from the styling prompt to these semantic names everywhere, so components never reference a specific brand directly.

**Colour rules:**
- Text on white uses `--brand-primary` or the `-text` variants only. **Orange and gold are never used for body text, links or white-text buttons.**
- **Primary buttons:** `--brand-primary` fill with white text (passes AA in both themes).
- **No gradients in the UI.** The Club8 gradient belongs to the logo only; don't imitate it in buttons, headers or backgrounds.
- **Keep status colours separate from brand colours.** Domain status colours (success/warning/danger, seasons) stay as defined in the styling prompt. Make sure the danger/warning colours are clearly distinguishable from Club8 orange and K8 gold, and adjust the warning hue if needed so an "overdue" badge never looks like a brand accent.

## 3. How the two brands appear in one CRM

The CRM is one shared system for both brands (companies are master data). The design approach:

1. **One application theme.**
   - The app shell (sidebar, buttons, focus rings) uses the **Club8 theme by default**, via `data-brand="club8"` on `<html>`.
   - The theme is a deployment setting (`NEXT_PUBLIC_DEFAULT_BRAND`), so it can be switched to K8 or a neutral theme without code changes.
   - **Do not re-theme the whole UI per member record**; colours changing between screens is confusing.
2. **Brand identity per record.** Wherever a record belongs to a brand, show that brand clearly but compactly:
   - **Member header:** the brand's icon (24px) + brand name as a small chip next to the membership number.
   - **Member/lead/reservation lists:** a brand column or chip; filterable by brand.
   - **Member application form:** the brand selector shows each brand's icon next to its name.
3. **Generated documents use the record's brand fully** (Section 5).
4. Record this approach in `docs/DESIGN_DECISIONS.md`, and add it to `docs/OPEN_QUESTIONS.md` for the client to confirm (Section 7).

## 4. Where the logos go in the app

| Location | What to show | Size / rules |
|---|---|---|
| **Login page** | Brand panel with the **Club8 logo** large and the **K8 logo** beside or below it at visually equal weight, on a white or very light (`--bg`) panel. A thin `--brand-accent` rule or soft tinted shape is allowed; no photography, no dark overlay. Sign-in card on the right. | Logos ~200–240px wide on desktop and ~160px on mobile (logo stacked above the card). Minimum clear space around each logo = the height of the "8". |
| **Sidebar header** (expanded) | Default brand's full logo on the white sidebar, with "CRM" in small `--text-muted` caps beneath. | Max height 40px; never wider than the sidebar minus padding. **The sidebar background must stay white/light** for the logo to be legible. |
| **Sidebar** (collapsed) and **mobile top bar** | Default brand's icon. | 28–32px. |
| **Browser tab** | Favicon and apple-touch-icon of the default brand, set via the Next.js App Router metadata (`app/icon.png`, `app/apple-icon.png`, or `metadata.icons`). Page titles: "Page · Club8 CRM" (or "K8 CRM" when the default brand is K8). | Use the 32/16 PNGs and the `.ico`; 180px for Apple. |
| **PWA manifest** (if present) | `name`, `short_name`, `theme_color` = `--brand-primary`, icons 192/512. | — |
| **Member header and lists** | The record's brand icon + name chip (Section 3). | Icon 20–24px. |
| **Empty states and 404/500 pages** | Small, muted default-brand icon above the message. | ≤ 48px; no full logo. |
| **`/styleguide`** | A "Brand" section showing both logos, both icon sets, colour swatches with hex values and contrast ratios, the clear-space rule, and the do/don't rules from Section 6. | — |

Do **not** put logos in every page header, table, toast or dialog. Once in the shell, plus per-record chips, is enough.

## 5. Generated PDFs (receipts, default notice, voucher)

Branding follows the **company of the record**, not the app theme.
- Add `logo_path` and `primary_colour` / `accent_colour` fields to the company master data (Club8 → club8 files and colours; K8 → k8 files and colours). The WeasyPrint templates read the brand from the record's company, so no brand is hard-coded in templates.
- **Header:** the full logo at top left (about 45mm wide), with the legal entity name and registered address at top right in small type. Use `--brand-primary` for headings and a thin `--brand-accent` rule under the header.
- Use the PNG files from `public/brand/`, embedded at print resolution (render them no larger than their pixel size allows at 300dpi). If they look soft when printed, flag it and request vector logos (Section 7).
- **Legal names on documents:**
  - Club8 documents show "Multiple Sales and Marketing LLP, promoter of CLUB8 Holidays".
  - K8 documents show the K8 legal entity from company master data. **Do not assume it is the same LLP.** Until the client confirms it, the seed data shows "Klub Eight Asia Ventures" with an "address pending confirmation" flag that prevents issuing K8 receipts in production.
- Body text stays black/dark grey for print. Colour must never carry meaning in documents.
- Add a test that generates a receipt for one Club8 and one K8 member (fictitious data) and checks that the correct logo and legal name appear.

## 6. Brand usage rules (put these in DESIGN_SYSTEM.md)

**Do:**
- Place logos on white or very light backgrounds only.
- Keep the clear space (the height of the "8") on all sides.
- Scale proportionally and keep the minimum sizes: full logo ≥ 120px wide, icon ≥ 16px.
- Use the per-record brand chip to show which brand a record belongs to.

**Don't:**
- Recolour, outline, add shadows to, stretch, crop or rotate the full logos.
- Place logos on dark, coloured or busy backgrounds (until white/reversed versions are supplied).
- Recreate the logos as text or SVG.
- Use the Club8 gradient elsewhere in the UI.
- Use orange or gold for body text or links.
- Show both brands' colours as the theme on the same screen.

## 7. Items to confirm with the client

Add these to `docs/OPEN_QUESTIONS.md`:
1. **Vector and reversed logos.** Ask for SVG (or PDF/AI/EPS) versions of both logos, plus **white/reversed** versions for dark backgrounds. The supplied JPGs work in the app but are limited for print and cannot sit on dark surfaces.
2. **Official app icons.** Are the provisional icons acceptable: the orange "8" for Club8, and the K8 monogram for K8? Or do they have official icons?
3. **K8 legal entity.** Is Klub Eight Asia Ventures a separate legal entity from Multiple Sales and Marketing LLP? Provide its registered name, address and GST details for receipts and notices.
4. **Default brand for the CRM shell.** Club8 (current default), K8, or a neutral "Club8 & K8 CRM" identity showing both?
5. **Brand fonts.** Do they have brand typefaces? The app keeps Inter for readability either way; brand fonts could be used on the login page and PDF headings only.

## 8. Definition of done

- Both logos and icon sets are in `public/brand/`, used through `next/image`, with correct `alt` text.
- Brand tokens use the exact values in Section 2 and are mapped to semantic tokens. No component references `club8`/`k8` colours directly, and no hard-coded hex values remain.
- Login, sidebar (expanded and collapsed), mobile top bar, favicon/tab title, member header chip, list brand chip, empty/error pages and `/styleguide` all show the correct brand assets.
- PDFs pick logo, colours and legal name from the record's company, and the Club8/K8 receipt test passes.
- Every text/background pair passes WCAG AA, the axe scan has no serious or critical issues, and no logo sits on a dark background anywhere.
- Before/after screenshots (desktop 1440px, mobile 390px) for login, dashboard, member record and one receipt PDF are saved in `docs/ui-audit/brand/`.
- All tests pass, and visual baselines are updated with a note in the summary.
