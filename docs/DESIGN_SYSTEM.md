# Design system

The CRM's visual language: **calm, trustworthy and efficient**. It's closer to a banking back-office tool than a travel site, with a warm touch of the Club8 brand. This page is the reference for tokens, components and usage rules. The live version is the `/styleguide` route. It's available in every non-production environment and to `ADMIN` users in production, and it uses fictitious data only.

Related: [Design decisions](DESIGN_DECISIONS.md) · [UI audit](ui-audit/AUDIT.md) (before/after screenshots).

## 1. Principles

1. **Find, then understand.** Search is always one keystroke away (`Ctrl/⌘+K`). Each record opens with the facts that matter: status, nights left, money owed, next booking.
2. **Precise and serious for money, KYC and audit.** Amounts use tabular figures and Indian grouping. IDs are monospace. Nothing is coloured without a text label.
3. **Comfortable-compact.** Use 14px body text and ~40px rows, with a compact toggle on tables. No hero sections and no decorative whitespace.
4. **Risky actions are deliberate.** They need a reason, the button is named after the action, and termination also needs a typed confirmation.
5. **Everything goes through tokens.** Components never contain hex values, Tailwind palette colours, pixel font sizes or ad-hoc spacing. `npm run lint` enforces this (`scripts/check-design-tokens.mjs`).

## 2. Tokens

Tokens are CSS variables in `frontend/src/app/globals.css`, stored as HSL channels (shadcn convention). `frontend/tailwind.config.ts` maps them to Tailwind and **replaces** the default palette, font sizes, radii and shadows, so only tokens exist.

### 2.1 Brand
Exact values from the client's logos (docs/BRAND_PROMPT.md section 2), checked against the supplied PNGs with a pixel
sampler: orange `#F07E1E`, indigo `#3C3084`, blue `#245AA8`, gold `#BA9C24`, navy `#182442`. These match the values below
to within anti-aliasing and JPG noise.

| Brand palette token | Hex | In the logo | On white |
|---|---|---|---|
| `--c8-indigo` | `#393186` | "HOLIDAYS", dark end of the "Club" gradient | 10.7:1 |
| `--c8-blue` | `#1E5AA8` | middle of the gradient | 6.8:1 |
| `--c8-cyan` | `#029ADB` | light end of the gradient | 3.2:1 (large text / icons only) |
| `--c8-orange` | `#EF7F1B` | the "8" and the sun | 2.7:1: **never text** |
| `--c8-orange-text` | `#B35F14` | darkened orange for text | 4.6:1 |
| `--k8-navy` | `#172040` | "KLUB EIGHT ASIA VENTURES" | 15.9:1 |
| `--k8-gold` | `#BC9C23` | the "K8" letters | 2.65:1: **never text** |
| `--k8-gold-text` | `#8B7319` | darkened gold for text | 4.6:1 |

Derived variants: `-hover` (darker, for button hover), `-subtle` (tinted background), `-border`.

**Components never use a brand palette directly.** They use the semantic tokens below, which the theme (`<html data-brand>`)
maps to one brand:

| Semantic token | Tailwind | Club8 theme (default) | K8 theme | Use |
|---|---|---|---|---|
| `--brand-primary` | `primary` | `--c8-indigo` | `--k8-navy` | Primary buttons, links, active nav/tab text, IDs, focus ring |
| `--brand-primary-hover` | `primary-hover` | `#2C2667` | `#0D1328` | Primary button hover |
| `--brand-primary-subtle` | `primary-subtle` | `#EEEDF8` | `#E9EBF2` | Active nav and tab backgrounds, selected rows, "Current" rate rows |
| `--brand-primary-border` | `primary-border` | `#B7B3DD` | `#AEB4C9` | Decorative brand borders (style guide clear-space box) |
| `--brand-accent` | `accent` | `--c8-orange` | `--k8-gold` | Active-nav indicator bar, login rule, DEV ribbon fill, stepper halo. **Thin indicators and fills only** |
| `--brand-accent-subtle` | `accent-subtle` | `#FEF1E4` | `#F8F3E1` | Stepper "current" halo |
| `--brand-accent-text` | `accent-text` | `--c8-orange-text` | `--k8-gold-text` | Accent-coloured text, **on white only** (4.6:1; it fails on the subtle tint) |
| `--brand-secondary` | `secondary` | `--c8-blue` | navy tint `#4A5677` | Secondary highlights: timeline reservation dot, entitlement "borrowed" bar |

**Colour rules**
- Text on white uses `primary` or `accent-text` only. Orange and gold are never body text, links or white-text buttons.
- Primary buttons: a `primary` fill with white text (10.7:1 Club8, 15.9:1 K8).
- No gradients in the UI. The Club8 gradient belongs to the logo only.
- Status colours stay separate from brand colours. The accent never fills a badge or chip (joining-offer chips and the timeline
  reservation dot were moved off it), so an amber warning or red overdue badge can't be mistaken for Club8 orange or
  K8 gold. Warning keeps its darker amber `#8A5300` on light amber fills, which reads as a status, not a brand mark.

### 2.1a Brand assets and usage
Files: `frontend/public/brand/{club8,k8}/` exactly as supplied: `*-logo.png` (full logo, transparent background), `*-icon-{16,32,180,192,512}.png`
and `*-favicon.ico`. The icons are provisional. The backend embeds copies of the two logos for PDFs
(`backend/app/correspondence/brand/`). A unit test keeps the copies byte-identical.

| Where | What | Size |
|---|---|---|
| Login | Both full logos at equal visual weight on a white panel, with a thin accent rule between them. Stacked above the card on phones | 240px wide (desktop), 140px (phone) |
| Sidebar, expanded | Default brand's full logo on the white sidebar, "CRM" in small caps beneath | 120px wide (the brand minimum) |
| Sidebar collapsed, mobile top bar | Default brand's icon | 32px / 28px |
| Browser tab | Favicon `.ico`, 16/32px PNG, 180px apple-touch-icon. Titles "Page · Club8 CRM" (or "K8 CRM") | — |
| Member header | Record's brand chip (icon + name) next to the membership number | icon 24px |
| Members list | Brand column (chip), filterable by brand | icon 20px |
| Member application | Selected brand's icon and name under the brand selector | icon 20px |
| Empty states, 404, error page | Default brand's icon, muted (40–50% opacity) | 28–48px |
| `/styleguide` | Brand section: both logos, icon sets, swatches with contrast, the clear-space box, do/don't | — |
| PDFs | The **record's** company logo top left (45 mm), legal entity and address top right, headings in its primary colour, a thin rule in its accent | 45 mm (about 480 dpi for Club8, 500 dpi for K8) |

**Do**
- Place logos on white or very light backgrounds only.
- Keep clear space equal to the height of the "8" on all sides.
- Scale proportionally, and keep the minimum sizes: full logo at least 120px wide, icon at least 16px.
- Use the per-record brand chip to show which brand a record belongs to.

**Don't**
- Recolour, outline, add shadows to, stretch, crop or rotate the full logos.
- Place logos on dark, coloured or busy backgrounds (until white or reversed versions are supplied).
- Recreate the logos as text or SVG.
- Use the Club8 gradient elsewhere in the UI.
- Use orange or gold for body text or links.
- Show both brands' colours as the theme on the same screen.

### 2.2 Neutrals and semantic colours
| Token | Value | Use |
|---|---|---|
| `--bg` | `#FAF9F7` | Page background (warm off-white) |
| `--surface` / `--surface-raised` | `#FFFFFF` | Cards and panels / popovers and dialogs (plus shadow) |
| `--surface-sunken` | `#F3F1ED` | Table headers, read-only inputs, wells |
| `--border` / `--border-strong` | `#E4E1DA` / `#8F8A82` | Dividers / input borders (3.4:1, meets the 3:1 rule for UI components) |
| `--text` / `--text-muted` / `--text-subtle` | `#1D1C24` / `#55535F` / `#6B6975` | Body / secondary / tertiary. All are AA on every surface |
| `--success`, `--success-subtle` | `#1B6E3F`, `#E5F3EA` | Paid, active, confirmed |
| `--warning`, `--warning-subtle`, `--warning-strong` | `#8A5300`, `#FCEFD6`, `#F6DCA6` | Pending approval, raised ASF, part-paid |
| `--danger`, `--danger-subtle` | `#B3261E`, `#FBE9E7` | Overdue, terminated, errors, destructive actions |
| `--info`, `--info-subtle` | `#0F5F8C`, `#E2F0F8` | New, requested, informational alerts |
| `--season-red`, `--season-red-bg` | `#7C2D25`, `#F2E0DC` | Red season chip (brick, deliberately unlike danger) |
| `--season-blue`, `--season-blue-bg` | `#1E4C78`, `#E1ECF7` | Blue season chip |

### 2.3 Contrast (WCAG 2.1 AA)
Generated by `npm run check:contrast -- --markdown` for both themes. CI fails if any pair drops below its threshold.
Brand-independent pairs are listed once, under the default theme.

| Theme | Pair | Ratio | Required | Result | Used for |
|---|---|---|---|---|---|
| Club8 (default) | `--text` on `--surface` | 16.71:1 | 4.5:1 | Pass | Body text on cards |
| Club8 (default) | `--text` on `--bg` | 15.74:1 | 4.5:1 | Pass | Body text on page |
| Club8 (default) | `--text-muted` on `--surface` | 7.52:1 | 4.5:1 | Pass | Secondary text |
| Club8 (default) | `--text-muted` on `--surface-sunken` | 6.65:1 | 4.5:1 | Pass | Secondary text in table headers |
| Club8 (default) | `--text-subtle` on `--surface` | 5.26:1 | 4.5:1 | Pass | Tertiary text, hints |
| Club8 (default) | `--text-subtle` on `--bg` | 4.96:1 | 4.5:1 | Pass | Tertiary text on page |
| Club8 (default) | `--text-subtle` on `--surface-sunken` | 4.65:1 | 4.5:1 | Pass | Hints on sunken wells |
| Club8 (default) | `--brand-primary` on `--surface` | 10.72:1 | 4.5:1 | Pass | Links, active nav text, IDs |
| Club8 (default) | `--brand-primary` on `--bg` | 10.10:1 | 4.5:1 | Pass | Links on the page background |
| Club8 (default) | `--brand-primary` on `--brand-primary-subtle` | 9.24:1 | 4.5:1 | Pass | Active nav / tab / selected chip |
| Club8 (default) | `--on-fill` on `--brand-primary` | 10.72:1 | 4.5:1 | Pass | Primary button |
| Club8 (default) | `--on-fill` on `--brand-primary-hover` | 13.31:1 | 4.5:1 | Pass | Primary button hover |
| Club8 (default) | `--brand-accent-text` on `--surface` | 4.61:1 | 4.5:1 | Pass | Accent-coloured text (on white only) |
| Club8 (default) | `--text` on `--brand-accent` | 6.15:1 | 4.5:1 | Pass | DEV ribbon (dark text on accent fill) |
| Club8 (default) | `--on-fill` on `--brand-secondary` | 6.81:1 | 4.5:1 | Pass | Secondary fills with white text |
| Club8 (default) | `--brand-secondary` on `--surface` | 6.81:1 | 4.5:1 | Pass | Secondary text / info highlights |
| Club8 (default) | `--on-fill` on `--danger` | 6.55:1 | 4.5:1 | Pass | Danger button, critical badge |
| Club8 (default) | `--success` on `--success-subtle` | 5.46:1 | 4.5:1 | Pass | Success badge / alert |
| Club8 (default) | `--warning` on `--warning-subtle` | 5.55:1 | 4.5:1 | Pass | Warning-subtle badge |
| Club8 (default) | `--warning` on `--warning-strong` | 4.80:1 | 4.5:1 | Pass | Warning badge |
| Club8 (default) | `--danger` on `--danger-subtle` | 5.67:1 | 4.5:1 | Pass | Danger-subtle badge, errors |
| Club8 (default) | `--danger` on `--surface` | 6.55:1 | 4.5:1 | Pass | Error text |
| Club8 (default) | `--info` on `--info-subtle` | 6.11:1 | 4.5:1 | Pass | Info badge / alert |
| Club8 (default) | `--season-red` on `--season-red-bg` | 7.22:1 | 4.5:1 | Pass | Red season chip |
| Club8 (default) | `--season-blue` on `--season-blue-bg` | 7.60:1 | 4.5:1 | Pass | Blue season chip |
| Club8 (default) | `--border-strong` on `--surface` | 3.38:1 | 3:1 | Pass | Input borders (UI component) |
| Club8 (default) | `--brand-primary` on `--surface` | 10.72:1 | 3:1 | Pass | Focus ring |
| Club8 (default) | `--brand-accent` on `--surface` | 2.72:1 | n/a | Decorative only | Accent (orange / gold) on white: NEVER text; thin indicators and fills only |
| K8 | `--brand-primary` on `--surface` | 15.93:1 | 4.5:1 | Pass | Links, active nav text, IDs |
| K8 | `--brand-primary` on `--bg` | 15.00:1 | 4.5:1 | Pass | Links on the page background |
| K8 | `--brand-primary` on `--brand-primary-subtle` | 13.36:1 | 4.5:1 | Pass | Active nav / tab / selected chip |
| K8 | `--on-fill` on `--brand-primary` | 15.93:1 | 4.5:1 | Pass | Primary button |
| K8 | `--on-fill` on `--brand-primary-hover` | 18.40:1 | 4.5:1 | Pass | Primary button hover |
| K8 | `--brand-accent-text` on `--surface` | 4.59:1 | 4.5:1 | Pass | Accent-coloured text (on white only) |
| K8 | `--text` on `--brand-accent` | 6.30:1 | 4.5:1 | Pass | DEV ribbon (dark text on accent fill) |
| K8 | `--on-fill` on `--brand-secondary` | 7.28:1 | 4.5:1 | Pass | Secondary fills with white text |
| K8 | `--brand-secondary` on `--surface` | 7.28:1 | 4.5:1 | Pass | Secondary text / info highlights |
| K8 | `--brand-primary` on `--surface` | 15.93:1 | 3:1 | Pass | Focus ring |
| K8 | `--brand-accent` on `--surface` | 2.65:1 | n/a | Decorative only | Accent (orange / gold) on white: NEVER text; thin indicators and fills only |

### 2.4 Typography
- **Inter** for all text (`next/font`, latin and latin-ext subsets, which include ₹ U+20B9). **JetBrains Mono** only for IDs and references: membership, receipt, reservation, lead and transaction numbers, and audit-log fields.
- **Tabular figures** on every table, input, `<Money>` and `.tabular-nums`, so amounts, dates and nights line up.
- **Scale** (the Tailwind theme contains only these sizes):

| Class | Size | Use |
|---|---|---|
| `text-3xl` | 30 | Login brand moment, big entitlement figure |
| `text-2xl` | 24 | Page titles (desktop) |
| `text-xl` | 20 | Page titles (mobile), stat-tile figures |
| `text-lg` | 18 | Dialog and drawer titles |
| `text-md` | 16 | Card titles |
| `text-base` | 14 | Body (default) |
| `text-sm` | 13 | Labels, table headers, dense tables |
| `text-xs` | 12 | Badges, hints, timestamps |

- **Weights:** 400 body, 500 labels and table headers, 600 headings and key figures. 700 is reserved for the login brand panel, the DEV ribbon and letter headings.

### 2.5 Spacing, shape, depth, motion
- 4px grid (Tailwind default spacing). Gaps: 8 within groups, 16 between fields, 24 between sections (`gap-5/6` on pages), 32 between regions.
- Radius: 6px for controls (`rounded-md`), 10px for cards and dialogs (`rounded-lg`), full for badges and chips.
- Depth: flat, with 1px borders. Shadows only for `popover` (menus, search results), `dialog` (dialogs, drawers) and `sticky` (member header once scrolled).
- Icons: Lucide, 16px in dense UI, 20px in navigation, one stroke weight.
- Motion: 150–200ms fades and slides for drawers, dialogs, toasts and hovers. Everything respects `prefers-reduced-motion`.
- Focus: a 2px `primary` outline with offset on every interactive element. Inputs show a `primary` border instead of an offset ring.

### 2.6 Dark mode
Not shipped (see Decisions). The tokens are structured so dark mode is only a `.dark` token block.

## 3. Domain colour semantics
Every status goes through **`<StatusBadge status="…">`** (`components/crm/StatusBadge.tsx`). It's the only place a status gets a colour. The badge text is the status code in small uppercase, so colour is never the only signal. Critical states also carry an icon.

| Domain | Status → tone |
|---|---|
| Lead | NEW info · CONTACTED neutral · PRESENTATION SCHEDULED primary · ATTENDED warning-subtle · CONVERTED success · NOT INTERESTED muted |
| Membership | PENDING APPROVAL warning (clock) · ACTIVE success · DEFAULT NOTICE danger-subtle (alert) · SUSPENDED warning (ban) · TERMINATED danger (octagon) · EXPIRED muted |
| Reservation | REQUESTED info · APPROVED primary · CONFIRMED success · DECLINED danger-subtle · CANCELLED muted, with struck-through dates · RESCHEDULED warning-subtle |
| Instalment / payment | PAID success · PART PAID warning · PENDING neutral · OVERDUE danger (alert), row tinted danger-subtle |
| ASF per year | NOT YET DUE outline · RAISED warning · PAID success |
| Other | Default notice OPEN / CURED · scan CLEAN / INFECTED · deduction HELD / DEDUCTED / CREDITED · entry NORMAL / REVERSAL / ADJUSTMENT · INACTIVE |

- **Seasons:** `<SeasonChip>`: Red (brick chip), White (white chip with a visible border, so it doesn't disappear on white), Blue (calm blue). Each has a matching dot.
- **Resort categories:** `<CategoryChip>`: Classic (outline) → Premium (primary-subtle fill) → Supreme (solid primary). No gold or metallic colours.

## 4. Formatting (shared utilities, `lib/format.ts`)
| What | Function | Example |
|---|---|---|
| Money | `formatMoney`, `<Money>` | `₹2,55,000.00`. Negatives are `-₹15,000.00` in danger colour, never brackets |
| Date | `formatDate` | `16-10-2026` (IST) |
| Date-time | `formatDateTime` / `formatTime` | `16-10-2026 4:05 pm` (12-hour, IST) |
| Relative | `formatRelativeDays` | `in 12 days`, `3 days overdue` |
| Phone in lists | `formatPhoneMasked` | `+91 98XXX XX308` |
| Phone in detail | `formatPhone` | `+91 98450 12345` |
| Nights | `formatNights` | `7.0`, `3.5` (always one decimal, because half nights exist) |
| Codes | `humanize` | `MEMBERSHIP_EMI` → `Membership EMI` |

## 5. Components
Primitives are in `components/ui.tsx`. App-level components are in `components/crm/`. Each covers its loading, empty, error and disabled states.

| Component | Rules |
|---|---|
| `Button` / `buttonClasses` | `default` (primary) for the one primary action per area. `outline` for secondary. `ghost` for row actions. `destructive` and `destructive-outline` for risky actions, **labelled with the action** ("Terminate membership", never "OK"). Links that look like buttons use `buttonClasses`, never `<a><button>`. |
| `Field` | Label above, required `*` (aria-hidden, outside the `<label>` so accessible names stay exact), hint below, error with icon. Wires `aria-describedby`, `aria-invalid` and `aria-required` on its control. `tag` holds the `AutoTag`. |
| `Input`, `PrefixInput`, `Select`, `Textarea`, `Checkbox` | 36px (44px on touch). `PrefixInput prefix="₹"` for INR, right-aligned. Read-only (`readonly`) fields are sunken. |
| `AutoTag` | Marks calculated read-only fields (total, balance, last year of use, ASF rate). The tooltip and hint explain the calculation. |
| `Card` | One `h2` title, optional description and actions. Use `padding="none"` around full-bleed tables. |
| `Alert` | `error` (role alert), `warning`, `info`, `success` (role status). Always has an icon. |
| `Tabs` | WAI-ARIA tabs with arrow/Home/End keys and optional counts. The caller renders the `tabpanel`. The URL reflects the tab on member records. |
| `Dialog` / `Drawer` | Native modal `<dialog>`: focus trap, Esc closes, focus returns to the opener. Drawers are for previews and add/edit side panels. |
| `ConfirmDialog` | Risky actions: mandatory reason (logged), optional typed confirmation, danger button named after the action. |
| `MaskedValue` | Masked KYC with an eye button for permitted users. Reveal → "This view will be logged" → auto-hides after 30 s. |
| `AppShell` | Grouped sidebar (collapsible to icons, a drawer on mobile), default brand logo (icon when collapsed), active item = primary-subtle + 3px accent bar, top bar with search, DEV/STAGING ribbon (`CRM_ENV`) and user menu. |
| `GlobalSearch` | ARIA combobox. `Ctrl/⌘+K`, arrows, Enter, Esc. Results grouped by type, with monospace refs and status badges. |
| `DataTable` | Server-paginated lists: sticky header, sort indicators on every sortable column, column visibility, density toggle, row click + Enter, row tones, stacked cards below 640px (column `meta.mobile`). |
| `Table`/`Th`/`Td`/`Tr` | Every other table. `align="right"` for money and numbers. Scrollable, labelled, focusable region. |
| `FilterBar` + `SavedSearches` | Search always visible (`/` focuses it). Other filters fold into "Filters" on phones. Saved searches are chips. |
| `MemberHeader` | Sticky. Number (mono, copy) + names + status + brand. Category/season/unit/nights chips. Stat tiles: nights left this year, outstanding balance, next check-in, ASF this year. Default-notice banner with countdown. Compresses on mobile behind "More". |
| `StatTile` | Label, key figure, secondary line. Clickable through to the filtered list. |
| `StatusStepper` | Normal path, current step, off-path end states. The next allowed actions sit below as buttons. |
| `Timeline` + `TypeChips` | Type icon on a coloured dot, IST time, actor, one-line summary that expands. |
| `ChangeList` | Audit diff as field / old (danger-subtle) / new (success-subtle). Long values are clamped with "more". |
| `Toast` | Success auto-dismisses after 5 s. Errors stay until dismissed and can offer Retry. `aria-live`. |
| `PageSkeleton`, `TableSkeleton`, `Empty`, `ErrorState` | Skeletons shaped like the content (no full-page spinners). One-line empty states with the primary action. Plain-language errors with Retry. A 409 conflict reads "Someone else updated this record" with Reload. |

## 6. Responsive
Breakpoints: mobile < 640, tablet 640–1024, desktop > 1024 (tested at 390, 768, 1280 and 1440).
- The sidebar becomes a drawer, and search stays in the top bar.
- Lists become stacked cards. Admin and audit tables scroll horizontally with a sticky first column.
- Forms are a single column on mobile, with a sticky action bar. New-lead capture is built for one hand.
- Touch targets are at least 44×44 (`touch:` variant = `pointer: coarse`).

## 7. Keyboard
`Ctrl/⌘+K` search · `/` focus the list filter · `Esc` close dialogs, drawers and menus · `Ctrl/⌘+S` save (member application, new lead, profile edit) · arrow keys in tabs and search results · Enter opens a focused table row.

## 8. Generated PDFs
`backend/app/correspondence/letters.py` (`LETTER_CSS`) wraps every editable letter template. The page is A4 with print-safe black text. The letterhead comes from the **record's company** (logo, legal entity, address, colours; see 2.1a). Headings use the company's primary colour, with a thin rule in its accent. Amount tables are clean and right-aligned, with a bold total and the GST row separate. Receipt, membership and reservation numbers and dates are monospace (`.ref`). The Default Notice uses black headings only.

## 9. Do and don't
- **Do** use `<StatusBadge>` for every status, `<Money>`/`formatMoney` for every amount, and `formatDate`/`formatDateTime` for every date.
- **Do** keep primary actions in `primary`, one per area.
- **Don't** use the accent (orange / gold) for text, links or text on white buttons; use `accent-text` on white when needed.
- **Don't** colour a status in a screen, or rely on colour alone.
- **Don't** add hex values, palette classes (`bg-red-500`), `text-[13px]` or `p-[3px]`. Add a token instead.
- **Don't** add visible text inside a `<label>` beyond the field name (tests and screen readers rely on exact names).
- **Never** use real member data in screenshots, fixtures or the style guide.

## 10. Verification
| Check | Command | Where |
|---|---|---|
| Token / hard-coded style check | `npm run lint` (`check:tokens`) | CI frontend job |
| Contrast of tokens | `npm run check:contrast` | CI frontend job |
| axe-core, 14 screens × 2 widths, no serious/critical | `npx playwright test a11y` | CI e2e job |
| Visual regression, 10 screens × 2 widths | `npx playwright test visual` | CI e2e job |
| Re-record API fixtures | `RECORD_FIXTURES=1 npx playwright test record-fixtures` | Locally, against the demo stack |
| Audit screenshots | `UI_AUDIT_DIR=after npx playwright test ui-audit` | Locally |
