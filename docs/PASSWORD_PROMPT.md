# Feature Prompt: Show-Password Toggle, Forgot Password, Password Reset and Change

## 0. Context and rules

The CRM was built from `docs/BUILD_PROMPT.md`: FastAPI backend, Next.js 15 frontend, Azure hosting, and staff logins with username/password (bcrypt), JWT in httpOnly cookies, account lockout and optional TOTP 2FA. Add the password features below.

Rules:
- **Security first.** These features are a common attack path into business systems. Follow every rule in Section 6. Where this prompt and convenience conflict, choose the secure option and record the decision in `docs/DECISIONS.md`.
- All business logic lives in FastAPI. Next.js only renders the screens and calls the API (same-origin `/api/v1/*`).
- Never log, store in plain text, email or display a password, a reset token or a full reset link: not in application logs, Application Insights, the activity log, error messages or analytics.
- Update `docs/BUILD_PROMPT.md` Section 3.1 and `docs/USER_GUIDE.md` to describe these features. All existing tests must still pass.

## 1. Show / hide password toggle

Apply to **every password field**: login, change password, reset password, and the admin "set temporary password" field.
- An eye icon button inside the right edge of the input switches between hidden (`type="password"`) and visible (`type="text"`).
- **Accessibility:**
  - It is a real `<button type="button">` with `aria-label` "Show password" / "Hide password" and `aria-pressed`.
  - It is keyboard-focusable and has the standard focus ring.
  - It has a tooltip with the same text.
  - Its icon (Lucide `Eye` / `EyeOff`) changes with the state.
- Toggling keeps the typed value and the cursor position, and does not submit the form.
- The field **always returns to hidden** after submit, on navigation, and when the page is restored from the browser's back/forward cache.
- Keep the correct `autocomplete` attributes so password managers work: `current-password` on login and the current-password field, `new-password` on new-password fields, and `username` on the username field.
- Show a **Caps Lock is on** hint under the field when detected.
- Do **not** add this toggle to KYC or other masked data fields. Those use the separate logged "Reveal" control from the styling prompt.
- Build it once as a shared `<PasswordInput>` component (shadcn `Input` + toggle), styled through design tokens, and use it everywhere.

## 2. Forgot password (self-service)

**Flow:**
1. The login page shows a **"Forgot password?"** link under the password field. It leads to `/forgot-password`, which asks for **username or registered email**.
2. On submit, the API **always returns the same response and takes about the same time**, whether or not the account exists: "If an account matches, we've sent password reset instructions to its registered email." This prevents attackers from discovering valid usernames (account enumeration).
3. If the account exists and is active, the backend:
   - generates a reset token (32 random bytes from `secrets.token_urlsafe`);
   - stores **only its SHA-256 hash** with the user ID, expiry, request IP and user agent;
   - **invalidates any earlier unused reset tokens** for that user;
   - emails a reset link to the **registered email only**. The address typed on the form is never used as the destination.
4. The link opens `/reset-password?token=…`. The page:
   - checks the token with the API before showing the form;
   - sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`;
   - removes the token from the address bar with `history.replaceState` after reading it.
5. The user enters a **new password** and **confirms it**, both using `<PasswordInput>`, with a live password-strength indicator and the policy shown up front (Section 5).
6. **If the account has 2FA enabled,** the reset form also asks for a current TOTP code. A password reset must never bypass or switch off 2FA.
7. On success:
   - the password hash is updated and the token marked used (single use);
   - **all refresh tokens and sessions are revoked** on all devices;
   - the failed-login counter and any lockout are cleared;
   - `password_changed_at` is set;
   - a **"Your password was changed"** notification email goes to the registered email, with the time and approximate location/IP and a line saying "If this wasn't you, contact your administrator immediately";
   - the user goes to the login page with a success message. The user is not signed in automatically.

**Rules (configurable, with these defaults):**
- Token lifetime **30 minutes**; single use; a newer request invalidates older tokens.
- Rate limits: **3 requests per account per hour** and **10 per IP per hour**. Requests beyond the limit get the same generic response and are not sent.
- Expired, used or invalid tokens show one generic message, "This reset link is invalid or has expired", with a button to request a new one.
- Inactive, suspended or deleted users get the generic response and no email. The attempt is still logged.
- Users without a registered email cannot self-reset. The forgot-password page says to contact an administrator; this message is shown to everyone, so it reveals nothing.

## 3. Admin-initiated password reset

For staff who are locked out, have forgotten their password, or have no access to email.
- On the Admin → Users screen, a **"Reset password"** action needs a new permission, `user.reset_password`. Seed it for `ADMIN` only.
- **Option A (default): send a reset link.** This triggers the same email flow as Section 2, sent to the user's registered email.
- **Option B: one-time temporary password,** for users without email access.
  - The system **generates** a strong temporary password; the admin cannot choose it.
  - It is shown **once** in a dialog with a copy button, a "Show" toggle and a warning to pass it on securely (in person or by phone, never by WhatsApp or email).
  - The account is flagged `must_change_password`. The temporary password **expires in 24 hours** if unused.
  - At next login, the user is sent straight to the **change password** screen and cannot use the rest of the app until it is changed.
- Both options:
  - revoke all the user's existing sessions;
  - require the admin to enter a **reason**;
  - notify the user by email when they have one.
- An admin can never see or set a user's actual password.
- **Safeguards:**
  - Admins cannot use this action on their own account; they use Change Password or Forgot Password.
  - Resetting another `ADMIN` account requires a second admin's approval, or is limited to a designated super-admin (record the choice in `DECISIONS.md`).
- **Separate action: "Reset 2FA"** with its own permission `user.reset_2fa` (ADMIN only, reason required, logged). It forces the user to enrol 2FA again at next login. A password reset never resets 2FA.

## 4. Change password (while signed in)

- In the user menu, **"Change password"** opens a page asking for the **current password**, the **new password** and a **confirmation**, all using `<PasswordInput>`.
- The current password is required and checked. Repeated wrong current-password attempts count toward lockout.
- There is a checkbox **"Sign out of all other devices"**, **ticked by default**. The current session stays signed in; when ticked, the others are revoked.
- On success, a notification email is sent and the change is recorded in the activity log.
- The same screen is the forced landing page when `must_change_password` is set (Section 3B). In that case the current field is labelled "Temporary password" and there is no option to skip.

## 5. Password policy (configurable, NIST SP 800-63B aligned)

- **Minimum 12 characters**, maximum 128. All printable characters and spaces are allowed, and passphrases are encouraged.
- **No forced composition rules** (e.g. "must include a symbol") and **no forced periodic expiry**. Change is required only on evidence of compromise or admin reset.
- **Reject:**
  - passwords found in a breached-password list. Use the Have I Been Pwned range API with k-anonymity (only the first 5 characters of the SHA-1 hash leave the server), with an offline top-100k common-password list as fallback if the API is unreachable;
  - passwords containing the username, the user's name or "club8"/"k8";
  - reuse of the **last 5 passwords**. Store their bcrypt hashes only.
- Show a **strength indicator** using `zxcvbn-ts` (client-side, guidance only). The server-side checks above are what enforce the policy.
- Error messages say what to fix, e.g. "This password has appeared in a data breach. Choose a different one."
- Policy values live in configuration/master data, not code.

## 6. Security requirements

- **Hashing:** bcrypt (cost ≥ 12) for passwords and password history. Reset tokens are stored as SHA-256 hashes only and compared in constant time (`hmac.compare_digest`).
- **No account enumeration:** forgot-password, login errors ("Incorrect username or password") and reset responses never reveal whether an account exists. Use similar response times; perform a dummy bcrypt check when the user doesn't exist.
- **Rate limiting:** `slowapi` backed by Azure Cache for Redis, per IP and per account, on login, forgot-password, reset-password and change-password. Add CAPTCHA (e.g. Cloudflare Turnstile or hCaptcha) on the forgot-password form after 3 attempts from the same IP; make it configurable.
- **Sessions:** a password reset or change (when "sign out of all other devices" is ticked) revokes refresh tokens server-side through a token-version/session table. Already-issued access tokens are short-lived (≤ 15 minutes).
- **Log hygiene:** scrub `token`, `password` and any reset URL from FastAPI logs, Next.js logs, Application Insights telemetry (a telemetry processor) and error reports. Add a test that runs the full flow and asserts that no token or password string appears in captured logs.
- **CSRF:** all password endpoints are POST and covered by the existing CSRF protection.
- **Email links:** built from a configured `APP_BASE_URL`, never from the request's `Host` header (prevents host-header poisoning).

## 7. Email delivery (Azure)

- Use **Azure Communication Services – Email**, with a verified sending domain (e.g. `no-reply@<club8 domain>`) and SPF, DKIM and DMARC configured. Add the resources to Terraform, and keep the connection details in Key Vault, accessed via managed identity.
- Send through an `EmailSender` interface with an Azure implementation and a **local/dev implementation that writes emails to a Mailpit container** (added to docker-compose), so the flows can be tested without real email.
- Sending is a background job (the existing worker) with retry. A failed send never changes the API response the user sees.
- **Templates:** Jinja2 HTML plus a plain-text version, branded with the default brand logo and colours from `BRAND_PROMPT.md`. Short and plain:
  - Reset email: the reset button, the expiry time ("valid for 30 minutes"), "If you didn't request this, you can ignore this email; your password hasn't changed", and the administrator contact.
  - Password-changed notification: when it happened and what to do if it wasn't you.
  - Neither email ever includes a password.

## 8. Activity log (append-only, per Section 10 of the build prompt)

Record these, with user, actor (for admin actions), time, IP and user agent, and **never** passwords or tokens:
- forgot-password requested (including for unknown or inactive accounts, recorded as "unknown account" without storing the typed value in full);
- reset email sent or failed;
- reset completed;
- reset link invalid or expired;
- password changed;
- admin reset (with option A/B and reason);
- temporary password issued, used and expired;
- 2FA reset;
- sessions revoked;
- lockout cleared;
- rate limit triggered.

## 9. Screens and UX

Follow the styling and brand prompts: tokens, `<PasswordInput>`, plain-language errors, and mobile-friendly layouts.
- **Login:** username, password with the show toggle, Caps Lock hint, the "Forgot password?" link, and a generic error on failure. The lockout message says when to try again or to contact an administrator.
- **Forgot password:** a single field and a submit button, then the same confirmation screen in every case, with a "Back to sign in" link.
- **Reset password:**
  - a validating state;
  - the invalid/expired state with a "Request a new link" button;
  - the form: new password, confirm, policy checklist, strength meter, and TOTP field when 2FA is enabled;
  - the success screen.
- **Change password:** under the user menu; the forced variant when `must_change_password` is set.
- **Admin → Users:** a "Reset password" action opening a dialog that offers option A or B, a required reason field and the one-time temporary password display; a separate "Reset 2FA" action. Destructive styling and confirmation follow the styling prompt.

## 10. Tests

**Backend (pytest), at minimum:**
- token generation, hashing, expiry, single use, and invalidation by a newer request;
- the enumeration-safe identical response for existing, unknown and inactive accounts;
- rate limits per account and per IP;
- the policy: length, breached-password check (mocked API plus fallback list), username/name check and history reuse;
- reset revokes sessions and clears lockout;
- 2FA is still required after a reset and on the reset form;
- the admin reset permissions and safeguards (no self-reset; ADMIN-on-ADMIN rule);
- the temporary password's 24-hour expiry and the forced change at login;
- the change-password current-password check and the "sign out other devices" behaviour;
- reset links are built from `APP_BASE_URL` even with a forged `Host` header;
- no token or password ever appears in captured logs or the activity log.

**Frontend (Vitest/RTL):**
- the `<PasswordInput>` toggle: accessible name, `aria-pressed`, keeps the value, resets to hidden after submit;
- the Caps Lock hint and the strength meter.

**End-to-end (Playwright with Mailpit):**
- full forgot → email → reset → login flow;
- expired-link flow;
- admin option-B temporary password → forced change flow;
- change password signs out another browser context.

## 11. Open questions (add to docs/OPEN_QUESTIONS.md)

1. Do all staff have a company email address? If many don't (e.g. field OPCs), should self-service reset also support a one-time code by **SMS** (e.g. via Azure Communication Services SMS) to the registered mobile? *(Default: email only; admin option B for everyone else.)*
2. Which domain should system emails come from, and who can add the SPF/DKIM DNS records for it?
3. Should **2FA be mandatory** for ADMIN, MANAGEMENT and FINANCE roles rather than optional? *(Recommended, given the financial and KYC data.)*
4. Who is the designated super-admin allowed to reset other admins?

## 12. Working on the existing app

The CRM is already built and has a demo environment with fictitious users (`demo.sales`, `demo.finance`, `demo.admin` and so on). Before writing code:
1. **Review what exists.** Read the current auth module, login page, user admin screens, session/refresh-token handling, lockout, 2FA and the activity-log hooks. List in `docs/PROGRESS.md` what is already there and what this prompt adds or changes. Reuse what exists; do not build a second auth path.
2. **Plan first.** Write a short plan (database migration, API endpoints, screens, tests) and stop for approval before implementing.
3. **Migrations:** new tables and columns (reset tokens, password history, `must_change_password`, `password_changed_at`, temporary-password expiry, session/token version) go in a new Alembic migration. Existing users keep their current passwords.
4. **Demo data:** give each demo user a fictitious email (e.g. `demo.sales@example.test`) so the flows can be shown locally through Mailpit. Never use real staff addresses in seed data.
5. **Walkthrough guide:** add a new chapter, "Passwords and account access", to the walkthrough guide (`docs/DEMO_SCRIPT.md` and the HTML walkthrough, if it is generated from the repo). Include fresh screenshots taken with the fictitious demo data:
   - the login page with the show-password toggle and the "Forgot password?" link;
   - the forgot-password confirmation;
   - the reset email in Mailpit;
   - the reset form with the policy checklist and strength meter;
   - the admin "Reset password" dialog (options A and B);
   - the forced change-password screen.
6. Commit when the tests pass.

## 13. Definition of done

- `<PasswordInput>` with the show/hide toggle is used on every password field and passes the accessibility checks.
- Forgot-password, reset, admin reset (options A and B), 2FA reset and change-password flows all work end to end locally (Mailpit) and in the dev environment (Azure Communication Services).
- All the security rules in Sections 5–6 are implemented and tested, including enumeration safety, rate limits, session revocation and log scrubbing.
- Every event in Section 8 appears in the activity log with no secrets recorded.
- Docs are updated: `BUILD_PROMPT.md` §3.1, `USER_GUIDE.md` (staff and admin instructions), `DECISIONS.md` and `OPEN_QUESTIONS.md`.
- All existing and new tests pass.
