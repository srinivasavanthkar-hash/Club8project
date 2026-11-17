# UI audit (before the restyle)

Screenshots: [`before/`](before/) at 1440px (`*-desktop.png`) and 390px (`*-mobile.png`) for 19 screens, captured with
`UI_AUDIT_DIR=before npx playwright test ui-audit --project=desktop` against the fictitious Section 14 demo data. The
same command with `UI_AUDIT_DIR=after` produced [`after/`](after/).

## Summary

The app works and is accessible at a basic level (labels, skip link, focus ring, `aria-sort`), but it has no visual
identity and no shared vocabulary for status, money or state. Most screens are stacks of identical white cards with
inline `·`-separated text. A member's situation can't be taken in at a glance.

## Inconsistencies found

### Brand and colour
- No Club8 brand at all. The primary colour is a generic sky blue (`hsl(199 89% 32%)`). There's no navy or orange and no logo; the wordmark is plain blue text.
- 10 hard-coded Tailwind palette classes (`bg-red-50`, `text-amber-900`, `bg-green-100`…) in `ui.tsx` and `providers.tsx`, outside the token system.
- The active nav item is a solid primary fill, the same treatment as the primary button, so the two compete.
- Destructive red buttons ("Issue default notice", "Cancel") sit next to primary buttons with the same weight and no confirmation.
- A half-built dark mode switches on automatically through `prefers-color-scheme`. Only 7 tokens are redefined, and the hard-coded status colours stay light, so on dark systems the result is low-contrast badges on a dark page.

### Typography
- The system font stack is used (Segoe UI on Windows, SF on macOS), so screens differ between machines. Nothing guarantees a ₹ glyph.
- No tabular figures. Amount, date and nights columns don't line up (visible in the EMI schedule and payment ledger).
- No monospace for IDs. Membership, receipt and reservation numbers and the audit hash look like body text.
- Heading sizes drift: page titles `text-xl`, card titles `text-base`, the dialog title has no size, and the lead heading mixes number and name in one `h1`.

### Status and domain colour
- `Badge` maps 15 status codes to colours. Others (`NEW`, `CONTACTED`, `PRESENTATION_SCHEDULED`, `ATTENDED`, `RESCHEDULED`, `PENDING`, `PART_PAID`, `NOT_YET_DUE`, `SUSPENDED`, `EXPIRED`, scan states) fall back to grey, so different states look identical.
- `REQUESTED` and `PENDING_APPROVAL` are both amber. `DECLINED` and `CANCELLED` are both grey.
- Overdue rows aren't highlighted. Status is shown by colour plus text but never with an icon.
- Seasons and resort categories are plain text ("WHITE / PREMIUM").

### Spacing, shape and depth
- Cards use `shadow-sm` everywhere, so they look raised for no reason. Radius is 8px on cards and 6px on inputs, with no rule behind it.
- Card padding is 16px, but inner lists have no spacing rhythm. Several lists run together, such as dashboard items and status history.
- Inputs and buttons are 40px tall, which feels loose on dense desktop screens, and there's no compact variant.

### Tables
- Six different table styles: `DataTable` (bordered, grey header), plus the finance, entitlement, reservations-tab and admin tables, which have unstyled `<th>`s with no padding and no header background.
- Money is left-aligned and uses proportional digits. Negative values (reversals) aren't coloured.
- Raw enum codes are shown (`DOWN_PAYMENT`, `MEMBERSHIP_EMI`, `SELF`, `INCOMING`).
- Sort indicators are text triangles that only appear once a column is sorted. Unsorted sortable columns look the same as columns that can't be sorted.
- On mobile, tables scroll sideways and cells wrap word by word (Leads at 390px).

### Navigation and shell
- The sidebar has no icons and no grouping. On mobile it pushes the content down instead of opening as a drawer.
- Global search has no keyboard shortcut, no result grouping, no status badges and no arrow-key navigation. Its `listbox` options are buttons.
- There's no environment indicator, so DEV and production look the same.
- The user menu is a name plus an underlined "Sign out" link, and roles aren't shown.

### Member record
- The header is one line: number, name, badge, and a raw UUID ("Member ID bcd0…"). There's no sticky summary, and nights remaining, outstanding balance, next check-in and ASF status aren't shown anywhere above the tabs.
- Tab labels have no counts. The Default Notice state shows no banner.
- Finance: the totals table and the outstanding line are inline text ("Outstanding EMI: ₹1,80,000.00 · Overdue EMI: — · ASF unpaid: —"). There's no progress indicator for the EMI schedule.
- Entitlement: an 11-column table with no visual cue for remaining nights, and no warning for saved nights close to expiry.
- KYC reveal is an underlined "Show (logged)" link with no confirmation and no auto-hide.

### Forms
- The 5-section member application has no progress indicator or section navigation. The sticky submit bar is a bare white strip.
- Read-only calculated fields (Total, Balance, Last year, ASF) look exactly like editable inputs.
- INR inputs have no ₹ prefix. Required fields aren't marked.
- Errors are shown per field only. There's no summary on submit.

### States
- Loading is a bare "Loading…" paragraph on every page, with no skeletons.
- Empty states are centred grey text with no action ("None.", "No schedule.").
- Errors are a red box. API errors are shown inline, and a 409 conflict gets no special treatment.
- No toasts: success is silent (for example after recording a payment or adding a note).

### Risky actions
- Document delete uses `window.prompt()` for the reason. Termination is an inline input plus a red button with no typed confirmation. Issuing a default notice happens in one click.
- "Save search" also uses `window.prompt()`.

### Mobile (390px)
- The header wraps over three lines (logo, search, sign out).
- Filter forms show all fields (8 on Leads) before any results.
- Some touch targets are under 44px (sort headers, "Correct" and "Receipt" links, tab buttons).

### Accessibility
- The `Tabs` component hard-codes `aria-label="Member sections"`, even on the Admin page.
- Icon-only controls (the menu "☰", the dialog "✕") use text glyphs.
- Badge text is `text-xs` on a pale fill. Most pairs pass AA, but there's no recorded check.
