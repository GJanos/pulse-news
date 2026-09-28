# Pulse — Todo

**Goal (since 2026-07-29):** "Go live" means a signed APK on GitHub Releases that people
download and install, announced on LinkedIn. No Play Store listing. Everything below is
scoped to that, in the order to do it.

---

## A. Switch it back on

The backend has been down since **2026-09-03**. Perplexity returns `401 insufficient_quota`
for every region, so no digest has been generated since. GitHub then disabled both scheduled
workflows (`disabled_inactivity`), and the Supabase project stopped answering on 2026-09-22,
most likely paused once the cron stopped keeping it warm.

- [ ] **Perplexity billing.** Top up / fix it at perplexity.ai/settings/api.
- [ ] **Restore the Supabase project** from the dashboard.
- [ ] **Check the live `delete_my_account` before overwriting it.** In the SQL editor:
      `select pg_get_functiondef(p.oid) from pg_proc p where p.proname = 'delete_my_account';`
      `CREATE OR REPLACE` would overwrite a no-arg `void` version (losing anything extra it
      does), errors if the return type differs, and adds an overload if it takes arguments.
      Make `schema.sql` match the live one first if it does more.
- [ ] **Apply the new SQL** from `supabase/schema.sql`: the updated `register_device` (only
      the service role may set `p_user_id` now) and `delete_my_account` if the check above
      says it's safe. The file is now safe to re-run as a whole.
- [ ] **Re-enable the workflows:** `gh workflow enable daily-digest.yml` and
      `gh workflow enable notify.yml` (or from the Actions tab).
- [ ] **Trigger Daily Digest manually** and confirm a green run, a new `pipeline_runs` row,
      and a push notification.
- [ ] **Merge `fix/pre-release-hardening`** → `develop` → `main`. Until the new workflow is
      on the branch the schedule runs from, the failure issue and the self-re-enable aren't
      live, and the schedules can get disabled again.
- [ ] Afterwards, confirm in the dashboard that the daily cron really keeps the Supabase
      project from pausing (free projects pause after ~7 days idle).

Once merged, failures are no longer silent: an all-regions failure writes a
`status = 'failed'` row to `pipeline_runs`, a failed scheduled run opens (or comments on) a
"Daily digest failing" GitHub issue, and every run re-enables both scheduled workflows.

## B. Custom SMTP (Brevo) — external testers can't sign up without this

Supabase's built-in sender only delivers to project team members and is capped at a couple
of messages per hour, so an external tester gets no confirmation mail and is stuck.
Decision: **Brevo**, individual-sender verification (no domain owned).

- [ ] Create a Brevo account (free tier: 300 emails/day).
- [ ] Brevo → **Senders, Domains & Dedicated IPs → Senders → Add a sender**. Brevo mails the
      address a verification link. This verifies a single address, no domain needed.
- [ ] Brevo → **SMTP & API → SMTP** → generate an SMTP key. Host `smtp-relay.brevo.com`,
      port `587`, login = the address shown on that page, password = **the SMTP key**, not
      the account password.
- [ ] Supabase → **Authentication → Emails → SMTP Settings** → enable custom SMTP with those
      values. Sender name: `Pulse`.
- [ ] Supabase → **Authentication → Rate Limits** → raise "emails per hour" off the default.
- [ ] Supabase → **Authentication → URL Configuration → Redirect URLs** → add
      `pulse://confirm` and `pulse://reset-password`. Without them Supabase rejects the
      redirect and the links die _even with SMTP working_.
- [ ] Check the **Confirm signup** and **Reset password** templates use
      `{{ .ConfirmationURL }}` and read like a real product.
- [ ] Test end-to-end from an address that is **not** a project team member: sign up →
      receive mail → tap link → lands in the app signed in. Repeat for password reset.

> ⚠️ With no domain the From address can't be DKIM-aligned, so Gmail/Outlook may file it
> under spam. Tell testers to check spam. A ~$10/yr domain fixes this and could also host
> the privacy policy — revisit if the spam rate is bad.

## C. Release signing — one-way door, before the first public APK

APK signatures can't change in place: if v1 ships debug-signed, moving to a real key later
forces every user to uninstall and lose their data. The config plugin
(`app/plugins/withReleaseSigning.js`) is done — it reads the env vars below and **fails the
release build** when they're unset instead of falling back to the debug key.

- [ ] Generate the keystore:
      `keytool -genkeypair -v -storetype PKCS12 -keystore pulse-release.keystore -alias pulse -keyalg RSA -keysize 2048 -validity 10000`
- [ ] Back it up (password manager + an offline copy) with both passwords and the alias.
      Losing it permanently ends the update path for everyone who installed.
- [ ] Set `PULSE_UPLOAD_STORE_FILE`, `PULSE_UPLOAD_STORE_PASSWORD`, `PULSE_UPLOAD_KEY_ALIAS`
      and `PULSE_UPLOAD_KEY_PASSWORD`, then build the release.
- [ ] `apksigner verify --print-certs app-release.apk` — the signer must be the new key, not
      `CN=Android Debug`.
- [ ] Agree the bump convention: `versionCode` +1 per release (now `1` in `app.json`),
      `versionName` = semver.

## D. Release smoke test on a clean device

Release builds have minify/ProGuard and `newArchEnabled=true` on. Reanimated, MMKV, Firebase
messaging, WebView and SVG are ProGuard-sensitive and can fail only in release, only at
runtime. Dev builds prove nothing.

- [ ] `adb uninstall com.pulse.news` first, so no dev build state masks a failure.
- [ ] Install the signed release APK and walk every flow: signup → email confirm deep link
      → digest loads → pager swipe → article WebView → every settings section → notify time
      change → push arrives → cold-start tap from notification → badge and tray clear →
      password reset deep link → delete account.
- [ ] Watch `adb logcat` for `ClassNotFoundException` / `NoSuchMethodError`; add `-keep`
      rules to `proguard-rules.pro` as needed.
- [ ] Fresh account: digests are shared per region per date, so a new signup should see
      today's digest immediately, not the "No digest available for your selected regions"
      empty state.

## E. Before publishing

### Build

- [ ] Consider trimming `reactNativeArchitectures` to `armeabi-v7a,arm64-v8a`. `x86,x86_64`
      are emulator-only and roughly double the APK size — but emulator release builds would
      stop working.
- [ ] Universal APK vs per-ABI splits. Universal is almost certainly right for a download page.

### Legal / trust — skipping the Play Store doesn't skip GDPR

- [ ] **Privacy policy** hosted at a URL (GitHub Pages, no domain needed). Must disclose:
      email (Supabase Auth), FCM device token, preferences and region selection; processors
      Supabase, Google/Firebase, Perplexity, Anthropic, Brevo; 7-day digest retention;
      deletion rights; a contact address. Worth stating: **no user personal data is sent to
      Perplexity or Anthropic** — only headline/article text.
- [ ] Link it from Settings (`SettingsFooter.tsx` already renders the version row).

### Operational — you're on the hook for other people's experience

- [ ] **Crash reporting.** There is none; a crash on a stranger's device is invisible.
      Sentry's free tier (5k events/mo) is enough.
- [ ] Confirm Supabase free-tier auth limits are comfortable. Cost is otherwise bounded:
      generation is per-region-per-day and doesn't scale with users, FCM is free, Brevo caps
      at 300 mails/day.
- [ ] Note in the README that `google-services.json` is gitignored, so a clone can't build
      without its own Firebase config.

## F. Release and launch

### Release page

- [ ] Tag `v1.0.0`, attach the APK, write release notes, publish the APK's SHA-256.
- [ ] **Install instructions are load-bearing.** Play Protect blocks unknown sideloaded APKs.
      Spell out: allow installs from unknown sources for the browser/file manager → on the
      Play Protect dialog tap _More details_ → _Install anyway_.
- [ ] State that sideloaded installs do **not** auto-update, and how people hear about new
      versions (watch the repo / follow the LinkedIn post).
- [ ] Point testers at GitHub Issues as the feedback channel.

### LinkedIn launch

- [ ] Screenshots (2–4) and a short GIF of the swipe + notification flow.
- [ ] Screenshots and a download badge at the top of the root README — for anyone arriving
      from LinkedIn, that README _is_ the landing page.
- [ ] Update the `GJanos` profile README entry with the release link and pin the repo.
- [ ] Post on LinkedIn.

---

## Done (2026-09-22, branch `fix/pre-release-hardening`)

- `delete_my_account` defined in `schema.sql` (deletes the caller's devices + `auth.users`
  row); `register_device` no longer trusts `p_user_id` from non-service callers; the file
  re-applies cleanly.
- `app/src/tests/schemaRpcs.test.ts` fails if the app calls an RPC `schema.sql` doesn't
  define, or if a function body loses its `$$` delimiters.
- Release signing plugin + `versionCode: 1`.
- `app/.env.example` uses `EXPO_PUBLIC_SUPABASE_KEY`; `client.ts` throws on a release build
  with no Supabase config.
- Failed-run reporting + workflow keepalive (see A).
- `LICENSE` — MIT.

---

## Parked — not doing now, keeping the notes

**Phase 3 — Image durability (server-side proxy/cache)**

_Parked 2026-07-29. Not needed for the sideload release; revisit if source-URL rot actually
bites during testing._

Client caching (expo-image) is already solved; this is purely source-URL rot.

- [ ] During the pipeline: download each `og:image`, resize (~400px WebP), upload to a Supabase Storage bucket, store the permanent bucket URL in `imageUrl`
  - Solves URL rot (articles 404 after days), 2–3MB image sizes, hotlink 403s. ~50–100 imgs/day ≈ trivial cost (free tier 1GB)
- _Open Q: resize/encode in Node cron (sharp) vs. Supabase image transform; plus a backfill + eviction policy alongside existing `db.evict`._

**Phase 4 — Usage statistics collector (new component, research-y)**

- [ ] Component to record usage stats (articles read, time in app) + handle device-registration deletion cleanup
  - Lawful basis = "legitimate interests" (no consent popup) **if** Privacy Policy discloses it; keep aggregate/pseudonymous (userID + articleID + timestamp)
  - If this ships, the privacy policy written above must disclose it up front
- _Open Q: event schema, collection path (app → `/api/...` → Supabase), and retention — the real brainstorm candidate._

**Other**

- [ ] Right to data export — lower priority, rarely enforced for small apps
- [ ] Start using bun as a package manager

---

## V2

- [ ] **Sources filtering**

- [ ] **Topic filtering** — user selects preferred/suppressed categories (economy, politics, sports…)

- [ ] **Pulse weekly** — clickable grey down-pointing caret next to "Pulse Daily"; dropdown for daily/weekly/monthly digest
  - Daily: ready; weekly = same call with `recency: week`; monthly = `recency: month`

- [ ] **Language / translation** — setting for returned article language; default English (no translation)
  - Cron side: translate the full digest after fetching, store alongside original in Supabase with a `lang` column on the `digests` table
  - Use DeepL (not Claude, not Mistral) — purpose-built for translation, free up to 500k chars/month, better quality than an LLM for most language pairs

---
