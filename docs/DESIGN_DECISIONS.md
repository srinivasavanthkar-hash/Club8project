# Design decisions (UI restyle)

This page records UX behaviour changes made in the UI layer during the restyle, and where the brief was followed differently and why. Business rules, API contracts and permissions are unchanged; see "Scope" at the end.

## Behaviour added in the UI layer
| Change | Why |
|---|---|
| **Keyboard shortcuts:** `Ctrl/⌘+K` focuses global search. `/` focuses the list's filter. `Ctrl/⌘+S` saves the member application, the new-lead form and the profile edit (the browser's "save page" is prevented). `Esc` closes dialogs, drawers and menus. Arrow keys work in tabs and search results. | Faster for all-day users. The shortcuts appear in the search field, the top bar and the forms. |
| **Inline validation on blur** (`react-hook-form` `mode: "onTouched"`) on the member application and the new-lead form, plus an **error summary** on submit that links to each field. | Mistakes surface while keying in from the paper form, not only at the end. The rules themselves are unchanged. |
| **Confirmation dialogs** before *Issue default notice*, *Terminate membership* (reason + type the membership number), *Cancel reservation*, *Delete document* (reason) and *Reveal KYC* ("This view will be logged"). They replace one-click buttons and `window.prompt()`. | Risky actions should feel deliberate. The same API calls are made with the same payloads. |
| **KYC reveal auto-hides after 30 seconds.** | Reduces shoulder-surfing. Each reveal is still a separate logged API call. |
| **Masked mobile numbers in lists** (`+91 98XXX XX308`). Full numbers stay on detail pages. | The brief's formatting rule, and less personal data on screen. |
| **Toasts** confirm successful saves. Errors stay inline. A **409 conflict** shows "Someone else updated this record" with Reload. | Silent success was a usability gap. |
| **Deep links into lists** (`/members?status=PENDING_APPROVAL`, `/leads?follow_up_due=1`, `?q=`). | Dashboard tiles open filtered lists, and duplicate warnings link to the matching record. |
| **Saved searches** became chips, and naming one uses an inline field instead of `window.prompt()`. | Same storage (per browser). |
| **Recent searches** are kept in memory for the browser tab only, never in `localStorage`. | They can contain names. |
| **Table preferences** (density, hidden columns) and **sidebar collapsed** are stored in `localStorage`. | Per-user conveniences. They contain no personal data. |
| **Read-only additions:** lead status counts, tab counts, and the member-header facts. These are extra `GET`s to existing endpoints with existing permissions (lead list with `page_size=1`, reservations, documents, entitlement, finance summary, ASF, notices), shared with the tabs through the same query keys. | The brief asks for status chips with counts and a member header with nights, balance, next check-in and ASF. No endpoint or contract was added or changed. |
| **ASF by year** shows years that have a charge plus the next not-yet-due year, with "Show all N years". | Ten "NOT YET DUE" rows pushed the useful rows off screen. All data is still one click away. |
| **Email and call forms** became two cards ("Log an email", "Log a call"), and emails/calls/timeline moved to a right-hand column. | Layout only. The fields and labels are unchanged. |
| **Environment ribbon** reads `CRM_ENV` at request time: `local`/`dev`/`test` → DEV, `staging` → STAGING, `prod` or unset → nothing. `CRM_ENV` was added to the web container in `docker-compose.yml` and `infra/terraform/modules/crm/apps.tf`. | One image is promoted dev → staging → prod, so the value can't be baked in at build time. Unset shows nothing, which is the safe default for production. |
| **`/styleguide`** route: available when `CRM_ENV` ≠ `prod`, or to `ADMIN` users in prod. | The living style guide. It uses fictitious data only and makes no API calls besides `/auth/me`. |

## Where the brief was applied differently
| Brief | What was done | Why |
|---|---|---|
| Status labels in sentence case | Badges show the status code in small uppercase ("PENDING APPROVAL"). Buttons and headings are sentence case. | The Section 14 Playwright demo asserts the uppercase text. The uppercase small-caps style is also common in back-office tools and keeps badges compact. |
| Confirm button **disabled** while ASF is unpaid | Confirm stays enabled and shows an explicit "Blocked: ASF 2026 unpaid. Record the ASF payment first, or give an override reason" message linked via `aria-describedby`. The amber ASF panel says the same. | The server is the gate. Users with `reservation.override` can confirm with a reason, which a disabled button would hide. The e2e demo also relies on the server's refusal message. |
| Member form sections: Purchaser · KYC · Membership · Payment · Joining Offer · Sales · Approval | The existing five sections (KYC inside Purchaser; Sales, Approval & Signatures together), with KYC as its own titled fieldset. | The headings mirror the paper form and are pinned by a unit test. Field order is unchanged as required. |
| Sticky footer "Save draft · Submit" | Submit only. The bar also shows the live total and balance. | There is no draft API, and adding one would be a behaviour change. |
| INR inputs format with Indian grouping on blur | `₹` prefix, right-aligned, and the grouped value shown under the field ("= ₹2,50,000.00"). The typed value is not rewritten. | Rewriting the input would change what is submitted and validated (`moneySchema` expects plain digits). |
| Lead status buttons named by target status | "Mark contacted", "Mark presentation scheduled", "Back to contacted", "Reschedule presentation". | Clearer verbs. They still contain the status words the e2e demo clicks. |
| "Edit button per section" on Profile | One Edit button, on Membership details, which edits inline. | Only the relationship manager and comments are editable through the API. Edit buttons on read-only sections would mislead. |
| Saved nights "expires Dec 2027" warning | Not shown. | The entitlement API doesn't return expiry dates for saved nights, and deriving them in the UI would duplicate a business rule. Request: add `saved_expires_on` to the year view. |
| Global search shows partly masked mobile and reservations | Results show member and lead number, names and status. | `/search` returns those fields only. The API wasn't changed. |
| Navigation item "Correspondence" | Not added. Correspondence lives on the member record. | There is no cross-member correspondence screen to link to. |
| Dark mode | Not shipped. The automatic `prefers-color-scheme` dark block that existed before was removed. | It was half-finished (status colours stayed light). The tokens are structured for a `.dark` swap later. |
| Lighthouse ≥ 90 in CI | Measured locally (results below). Not gated in CI. | Lighthouse in CI needs a stable, seeded, authenticated environment. The axe-core gate covers the accessibility rules that matter. |

## Brand (docs/BRAND_PROMPT.md, 19-10-2026)
| Decision | Detail |
|---|---|
| **One application theme** | The app shell (sidebar, buttons, focus rings) uses the deployment's default brand: `NEXT_PUBLIC_DEFAULT_BRAND` = `club8` (default) or `k8`, applied as `<html data-brand>`. It's a Docker build arg (`frontend/Dockerfile`, `docker-compose.yml`) because `NEXT_PUBLIC_*` is inlined at build time, so switching brand means a rebuild, not a code change. The UI is **not** re-themed per record. |
| **Brand per record** | Member header: brand chip (icon + name) next to the membership number. Members list: Brand column; the existing company filter is relabelled "Brand". Member application: the selected brand's icon and name under the selector. |
| **Lists without a brand** | Leads and reservations have no company link in the data (a lead has no company until conversion, and reservation rows don't carry the member's company), so they show no brand chip. Adding one would need an API change. |
| **API change (additive)** | `GET /members` list rows gained `company_id`, which the list brand chip needs. Nothing was removed or renamed. `docs/openapi.json` was regenerated. |
| **Documents follow the record** | Receipts, notices and vouchers take logo, colours and legal entity from the record's company. Companies gained `logo_path`, `primary_colour`, `accent_colour` and `details_pending_confirmation` (migration `0002`). Colours are validated as `#RRGGBB` before use in PDF styles. The letterhead is added by the renderer, so editable templates no longer print the company header themselves. Migration `0002` updates only template rows still identical to an earlier default. |
| **K8 legal entity** | The demo K8 company now shows "Klub Eight Asia Ventures" with `details_pending_confirmation = true`, never the Club8 LLP. While the flag is set, **K8 receipts are refused in production** (`CompanyDetailsPending`). Other environments print a "Legal entity details pending confirmation" box. Migration `0002` applies the same change to an existing K8 row whose legal name is still the Club8 LLP. |
| **Provisional icons** | `*-icon-*.png` and `*-favicon.ico` are provisional crops of the client's artwork (the Club8 orange "8", the full K8 monogram). The K8 icon's small "KLUB EIGHT ASIA VENTURES" text is unreadable at 16–32px. Replace when official icons or SVG logos arrive (OPEN_QUESTIONS 21–22). |
| **K8 logo file padding** | The supplied `k8-logo.png` is 1053×938 with about 420px of transparent space below and right of the artwork (artwork 26–922 × 28–512), not the trimmed 950×530 the prompt describes. The file is **not edited**. The app and PDFs frame the artwork area with CSS (`Brand.logo.frame` / `LOGO_FRAMES`). Request a re-trimmed file (OPEN_QUESTIONS 21). |
| **Sidebar logo size** | The prompt asks for a maximum height of 40px in the sidebar header *and* a minimum full-logo width of 120px. Club8's logo at 40px tall is only 54px wide, with "HOLIDAYS" about 4px high. The 120px brand minimum wins: the sidebar header is taller (logo plus "CRM"), and the top bar is unchanged. |
| **Accent usage** | Orange and gold are used only as thin indicators and fills (active-nav bar, login rule, DEV ribbon, stepper halo). The joining-offer chip and the timeline reservation dot moved off the accent, so no badge-like element uses a brand accent and status colours stay unambiguous. |
| **Empty states** | The default brand's icon, muted with opacity (not recoloured), sits above empty-state messages that have no specific icon, and on the 404 and error pages. |
| **Favicon and titles** | Set through App Router `metadata.icons` from the default brand. Client pages set "Page · Club8 CRM" via `usePageTitle`. The earlier placeholder `icon.svg` was removed, and `/brand/` is excluded from the auth middleware so logos load on the login page. |
| **PWA manifest** | None exists, so none was added (the prompt says "if present"). |

## Lighthouse (desktop preset, local production build, 16-10-2026)
| Screen | Accessibility | Best practices | Performance |
|---|---|---|---|
| /login | 100 | 100 | 100 |
| / (dashboard) | 100 | 100 | 100 |
| /leads | 100 | 100 | 99 |
| /members | 100 | 100 | 100 |
| Member · profile | 100 | 100 | 95 |
| Member · finance | 100 | 100 | 89 |
| Member · entitlement | 100 | 100 | 92 |
| Reservation detail | 100 | 100 | 100 |
| /finance | 100 | 100 | 100 |
| /activity | 100 | 100 | 99 |

## Scope: what did not change
- **Business logic:** zod schemas, `toPayload`, money arithmetic (`addMoney`/`subMoney`), lead transitions (`NEXT`), the reservation quote/submit flow, and every mutation payload are identical. Diffs are in markup and class names.
- **API contracts:** no endpoints or parameters changed, and no fields were removed. Added calls are read-only `GET`s listed above. The brand work added one response field, `company_id` on `GET /members` list rows.
- **Permissions:** every `can(...)` check is preserved. Navigation, tabs and actions show for the same permissions as before.
- **Backend:** `correspondence/letters.py` for PDF styling and the brand letterhead, the company branding columns (migration `0002`), the K8 receipt guard, and `company_id` on member list rows (see Brand). Before that, only `correspondence/letters.py`, for PDF styling (`LETTER_CSS`, plus `class="ref"` and `class="amounts"`/`"total"` markup in the default templates; the wording is unchanged).
