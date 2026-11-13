# Progress: passwords and account access (docs/PASSWORD_PROMPT.md)

## What already existed (reviewed 13-11-2026)
| Area | State before | Where |
|---|---|---|
| Sign-in | Username + password (bcrypt cost 12), constant-time check for unknown users, lockout after 5 failures for 15 min, per-IP rate limit 10/min | `auth/service.py:login`, `core/security.py` |
| Sessions | JWT access token (15 min) + rotating refresh token (7 days) in httpOnly cookies; refresh-token reuse revokes all of a user's refresh tokens; CSRF double-submit | `auth/service.py`, `core/middleware.py` |
| 2FA | Optional TOTP (API only, no screen); secret Fernet-encrypted | `/auth/totp/setup`, `/auth/totp/confirm` |
| Users | Admin created users and **typed their initial password**; `must_change_password` was set but never enforced; no way to change or reset a password | `admin/service.py:create_user` |
| Audit | Hash-chained activity log; `password_hash`/`totp_secret_enc` already redacted in change records | `audit/service.py` |

Gaps found during the review and fixed in Phase 1:
* `/auth/totp/setup` switched 2FA **off** for anyone holding a session, without a code (D-PW-5).
* Access tokens stayed valid for up to 15 minutes after any change (D-PW-4).
* The initial-password policy forced mixed case and a digit (composition rules) instead of length and screening.

## Phase 1 (this branch, no email needed)
| Requirement | Done | Notes |
|---|---|---|
| `<PasswordInput>` with show/hide toggle on every password field | ✓ | `components/PasswordInput.tsx`: button with `aria-label`/`aria-pressed`/`aria-controls`/tooltip, keeps value and caret, hidden again after submit / pagehide / bfcache restore / navigation, Caps Lock hint, correct `autocomplete`. Login, change password, temporary-password dialog. |
| Change password (current required, "sign out of all other devices" ticked by default) | ✓ | `/change-password`, `POST /auth/change-password`; wrong current password counts toward lockout |
| Enforce `must_change_password` (sign in → 2FA → forced change, nothing else reachable) | ✓ | server-side gate in `core/deps.py` (D-PW-2) |
| Admin reset with system-generated temporary password, shown once, 24 h, reason, no self-reset, `user.reset_password` | ✓ | `POST /admin/users/{id}/reset-password` |
| ADMIN-on-ADMIN: second-admin approval, super-admin fallback by configuration | ✓ | `/admin/reset-requests`, D-PW-3, OPEN_QUESTIONS 27 |
| New users get a generated temporary password (admins never type passwords) | ✓ | `POST /admin/users` |
| Reset 2FA (`user.reset_2fa`), forced re-enrolment, password untouched | ✓ | `POST /admin/users/{id}/reset-2fa`, `/setup-2fa` screen |
| Token version checked on every request (no Redis, no extra query) | ✓ | D-PW-4 |
| Policy: ≥ 12, no composition rules, breached (HIBP + offline), no username/name/club8/k8, last 5, strength meter | ✓ | `auth/policy.py`, `auth/breach.py`, `components/PasswordStrength.tsx`; values in `system_settings` |
| Rate limiting on login and change password (per IP and per account) | ✓ | D-PW-7 |
| Activity log for every event, no secrets; log-scrubbing test | ✓ | events: `LOGIN`, `LOGIN_FAILED`, `PASSWORD_CHANGED`, `PASSWORD_CHANGE_FAILED`, `PASSWORD_RESET_BY_ADMIN`, `PASSWORD_RESET_SUPER_ADMIN`, `TEMP_PASSWORD_ISSUED/USED/EXPIRED`, `ADMIN_RESET_REQUESTED/APPROVED/REJECTED/CANCELLED/EXPIRED`, `TOTP_ENABLED`, `TOTP_RESET_BY_ADMIN`, `SESSIONS_REVOKED`, `LOCKOUT_CLEARED`, `RATE_LIMITED` |
| Migration | ✓ | `0003_password_security`: existing users keep their passwords; history backfilled; permissions granted to ADMIN only |
| Expiry job | ✓ | `expire_account_recovery` every 15 min (temporary passwords, ADMIN reset requests) |
| Tests | ✓ | backend `tests/integration/test_passwords.py` (13), `tests/unit/test_passwords_unit.py` (13); frontend `PasswordInput.test.tsx`, `PasswordStrength.test.tsx`, `LoginForm.test.tsx`; Playwright `e2e/passwords.spec.ts` (7, incl. axe scans of the new screens) |
| Walkthrough chapter "Passwords and account access" | ✓ | `docs/demo-tour/index.html` chapter 11, screenshots 27–35 (`TOUR=1 npx playwright test passwords`) |
| Docs | ✓ | DECISIONS (D-PW-1…8), OPEN_QUESTIONS (27–30), BUSINESS_RULES (password settings), USER_GUIDE (staff + admin) |

Not in this repository: `docs/BUILD_PROMPT.md` (the prompt asks for its Section 3.1 to be updated; the file was never
added here). The equivalent content is in USER_GUIDE.md and DECISIONS.md.

## Phase 1 follow-ups (13-11-2026)
| Item | Done | Notes |
|---|---|---|
| Test data leaking into the demo | ✓ | Demo database rebuilt clean (8 demo users + Section 14 scenario). Data-writing Playwright specs refuse to run unless the API reports `e2e_target`; `scripts/run_e2e.py` runs them on a fresh `crm_e2e` database (D-PW-12) |
| 2FA before the forced change | ✓ | `mfa` token claim; change password refuses sessions without 2FA (`MfaRequired`); tests for the order and for a pre-2FA session (D-PW-9). `demo.admin` has 2FA on (D-PW-13) |
| Mandatory 2FA per role | ✓ | `security.require_2fa_roles` + admin card; off by default; OPEN_QUESTIONS 30 (D-PW-10) |
| Roles multi-select with reason | ✓ | D-PW-11 |
| Walkthrough | ✓ | Screenshots 27–35 retaken as demo.admin on the isolated stack; 36 (2FA step) and 37 (roles + 2FA policy) added |

## Phase 2 (13-11-2026): email and forgot password
| Requirement | Done | Notes |
|---|---|---|
| `EmailSender` interface, Mailpit (docker-compose + local binary), Azure Communication Services (Terraform, Key Vault, managed identity) | ✓ | D-PW-19, D-PW-20 |
| Forgot password: enumeration-safe answer and timing, registered email only, hashed single-use 30-minute tokens, newer invalidates older | ✓ | D-PW-14, D-PW-15 |
| Rate limits 3/account/hour and 10/IP/hour (same answer, nothing sent); CAPTCHA after 3 per IP (configurable) | ✓ | D-PW-16 |
| Reset page: checks the link first, removes the token from the address bar, no-referrer / no-store, policy checklist + strength meter, TOTP field with 2FA | ✓ | `/reset-password` |
| Completing a reset: sessions revoked, lockout cleared, `password_changed_at`, notification email, not signed in | ✓ | D-PW-17 |
| Admin option A (send reset link) next to option B; ADMIN-on-ADMIN approval for both; notifications | ✓ | D-PW-18 |
| Notifications: password changed (self, reset), admin reset, 2FA reset; never a password in an email | ✓ | `security_notice` template |
| Activity log: forgot requested (incl. unknown/inactive, truncated), email sent/failed, reset completed, link invalid/expired, rate limit | ✓ | |
| Demo users with `@example.test` addresses | ✓ | D-PW-21 |
| Tests | ✓ | backend `test_password_reset_email.py` (11) + template unit test; frontend `ResetPasswordPage.test.tsx`; Playwright `reset.spec.ts` (4, Mailpit): forgot → email → reset → sign in, used and replaced links, 2FA on the reset form, admin option A |
| Walkthrough | ✓ | chapter 11 screenshots 38–42 (forgot confirmation, the email in Mailpit, reset form, invalid link, admin options) |

Still outside this repository: `docs/BUILD_PROMPT.md` Section 3.1 (the file was never added here).

## Phase 2 plan (as agreed)
* `EmailSender` interface; Mailpit in docker-compose (local); Azure Communication Services Email for dev/prod
  (Terraform, Key Vault, managed identity, SPF/DKIM/DMARC); sending as a worker job with retry.
* "Forgot password" (Section 2): enumeration-safe response, SHA-256-hashed single-use 30-minute tokens, rate limits
  3/account/hour and 10/IP/hour, CAPTCHA after 3 attempts, `APP_BASE_URL` links, `Referrer-Policy: no-referrer`,
  token removed from the address bar, TOTP on the reset form.
* Admin reset option A "send reset link" (Section 3A); "password changed" notification emails.
* Telemetry scrubbing of URLs (reset tokens appear in URLs only from Phase 2).
* Demo users get `@example.test` addresses; e2e forgot → Mailpit → reset → login, expired link.
