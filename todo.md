# Pulse — Todo

**Goal shift (2026-07-29):** "Go live" no longer means Play Store listing. It means:
ship a signed APK to GitHub Releases, let people download and install it, and post about
it on LinkedIn. Everything below is scoped to that.

---

## Now — blocks everything else

### 1. Custom SMTP (Brevo) — external testers can't sign up without this

Supabase's built-in email sender only delivers to project team members and is capped at a
couple of messages per hour. Any external tester who signs up today gets no confirmation
mail and is stuck. Decision: **Brevo**, individual-sender verification (no domain owned).

- [ ] Create a Brevo account (free tier: 300 emails/day — far more than needed)
- [ ] Brevo → **Senders, Domains & Dedicated IPs → Senders → Add a sender**. Enter the
      address emails will come from; Brevo mails it a verification link. This is the
      no-domain path — it verifies a single address rather than a whole domain.
- [ ] Brevo → **SMTP & API → SMTP** tab → generate an SMTP key. Note:
      host `smtp-relay.brevo.com`, port `587`, login = the address shown on that page,
      password = **the generated SMTP key**, not the account password.
- [ ] Supabase Dashboard → **Authentication → Emails → SMTP Settings** → enable custom
      SMTP and fill in the four values above. Sender name: `Pulse`.
- [ ] Supabase → **Authentication → Rate Limits** → raise "emails per hour" off the
      default (it stays at the built-in low cap until custom SMTP is on).
- [ ] **Supabase → Authentication → URL Configuration → Redirect URLs** — add
      `pulse://confirm` and `pulse://reset-password`. Without these on the allowlist,
      Supabase rejects the redirect and the links die _even with SMTP working_. This is
      the silent-failure counterpart to the deep-link work in PRs #49/#50.
- [ ] Check the **Confirm signup** and **Reset password** templates still use
      `{{ .ConfirmationURL }}` and read like a real product, not a default.
- [ ] Test end-to-end from an address that is **not** a project team member: sign up →
      receive mail → tap link → lands in the app signed in. Repeat for password reset.

> ⚠️ Deliverability caveat: with no domain, the From address can't be DKIM-aligned to a
> domain you control, so Gmail/Outlook may file it under spam. Tell testers to check
> spam. A ~$10/yr domain would fix this properly and could also host the privacy policy —
> worth revisiting if the spam rate is bad.

### 2. Release signing — one-way door, fix before the first public APK

`app/android/app/build.gradle` currently has `release { signingConfig signingConfigs.debug }`
(the stock Expo placeholder). The `app-release.apk` in build outputs right now is signed
with the public Android debug key (`storePassword 'android'`). Anyone can forge an update
for it, and **if v1 ships debug-signed, switching to a real key later forces every user to
uninstall and lose their data** — APK signatures cannot change in place.

- [ ] Generate a real keystore:
      `keytool -genkeypair -v -storetype PKCS12 -keystore pulse-release.keystore -alias pulse -keyalg RSA -keysize 2048 -validity 10000`
- [ ] Back it up (password manager + an offline copy) along with both passwords and the
      alias. Losing it permanently ends the update path for everyone who installed.
- [ ] Wire it so it survives `expo prebuild`. **`android/` is gitignored and regenerated,
      so editing `build.gradle` directly gets wiped.** Two options:
  - Add an Expo config plugin under `app/plugins/` (matches the existing
    `withNavigationBarContrast` idiom) that injects `signingConfigs.release`, reading
    credentials from env vars; or
  - Add `eas.json` with an APK profile (`buildType: apk`, `distribution: internal`) and
    let EAS manage credentials.
- [ ] Add `"versionCode"` under `android` in `app.json` — it is currently absent, so every
      prebuild emits `versionCode 1` and no build can ever update another. Agree a bump
      convention (versionCode +1 per release, versionName = semver).
- [ ] Verify with `apksigner verify --print-certs app-release.apk` that the signer is the
      new key, not `CN=Android Debug`.

### 3. Verify `delete_my_account` actually exists

`app/src/hooks/useSupabaseAuth.ts:96` calls `client.rpc('delete_my_account')`, but that
function is **not defined in `supabase/schema.sql`** — the only RPCs there are
`register_device`, `update_notify_time`, `link_device_to_user`, `peek_due_notifications`,
`claim_due_notifications`. The test at `useSupabaseAuth.test.ts:169` mocks the RPC, so the
suite is green either way.

- [ ] Check the live DB. Either it exists and `schema.sql` has drifted (fix the reference),
      or it was never created and in-app account deletion is broken for every user.
- [ ] If missing: write it as `SECURITY DEFINER`, deleting from `auth.users` for
      `auth.uid()`. `user_preferences` cascades; `devices.user_id` is `ON DELETE SET NULL`
      — decide whether the device row should be deleted rather than orphaned.
- [ ] Add a test that fails when the RPC is absent, not just when it isn't called.

### 4. `app/.env.example` has the wrong variable name

Declares `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, but `app/src/supabase/client.ts:10` reads
`EXPO_PUBLIC_SUPABASE_KEY`. Commit `6d8bf7f` corrected this in the README but missed the
example file. A release built from a fresh `.env` copy silently runs in "local-only mode"
with no backend.

- [ ] Fix the name in `app/.env.example`.
- [ ] Make `client.ts` fail loudly on a release build instead of warning and continuing.

### 5. Release-build smoke test on a clean device

`android.enableMinifyInReleaseBuilds=true` and ProGuard are **on** for release, plus
`newArchEnabled=true`. Reanimated, MMKV, Firebase messaging, WebView and SVG are all
ProGuard-sensitive and can fail only in release, only at runtime. Dev builds prove nothing.

- [ ] `adb uninstall com.pulse.news` first, so no dev build state masks a failure.
- [ ] Install the signed release APK and walk every flow: signup → email confirm deep link
      → digest loads → pager swipe → article WebView → every settings section → notify
      time change → push arrives → cold-start tap from notification → badge and tray clear
      → password reset deep link → delete account.
- [ ] Watch `adb logcat` for `ClassNotFoundException` / `NoSuchMethodError` — the ProGuard
      signature. Add `-keep` rules to `proguard-rules.pro` as needed.

---

## Ship — GitHub Releases

### Build

- [ ] Consider trimming `reactNativeArchitectures` to `armeabi-v7a,arm64-v8a`. It currently
      includes `x86,x86_64`, which only emulators use, and they roughly double APK size.
- [ ] Decide universal APK (one file, simpler for a download page) vs per-ABI splits.
      Universal is almost certainly right here.
- [ ] Publish the APK's SHA-256 in the release notes — cheap, real trust signal for a
      sideloaded binary.

### Legal / trust — still applies without a store

Skipping the Play Store does not skip GDPR. You're in the EU, you collect email addresses
and device tokens, so a privacy policy is still genuinely required — not just store box-ticking.

- [ ] **Privacy policy** hosted at a URL. GitHub Pages is free and needs no domain. Must
      disclose: email (Supabase Auth), FCM device token, preferences and region selection;
      processors Supabase, Google/Firebase, Perplexity, Anthropic, Brevo; 7-day digest
      retention; deletion rights; a contact address.
      Worth stating accurately: **no user personal data is sent to Perplexity or Anthropic**
      — only headline/article text flows there. That's a genuine selling point.
- [ ] Link it from Settings (`SettingsFooter.tsx` already renders the version row).
- [ ] `LICENSE` — MIT. _(added 2026-07-29)_
- [ ] Account deletion must actually work — see blocker #3.

### Release page

- [ ] Tag `v1.0.0`, attach the APK, write release notes.
- [ ] **Install instructions are load-bearing.** Android will show "unsafe app blocked" via
      Play Protect for an unknown sideloaded APK. Spell out: allow install from unknown
      sources for the browser/file manager → on the Play Protect dialog tap _More details_
      → _Install anyway_. Without this most non-technical downloaders just bounce.
- [ ] State clearly that sideloaded installs do **not** auto-update, and how people will
      hear about new versions (watch the repo / follow the LinkedIn post).
- [ ] Note in the README that `google-services.json` is gitignored, so a clone can't build
      without supplying their own Firebase config.

### Operational — you're now on the hook for other people's experience

- [ ] **Crash reporting.** There is none. Right now a crash on a stranger's device is
      completely invisible to you. Sentry's free tier (5k events/mo) is enough.
- [ ] Confirm the first-run experience: digests are one row per region per date shared
      across all users, so a new signup should see today's digest immediately rather than
      the "No digest available for your selected regions" empty state. Verify with a fresh
      account before anyone else does.
- [ ] Cost exposure is bounded — digest generation is per-region-per-day and does **not**
      scale with user count. FCM is free. Brevo caps at 300 mails/day. Worth confirming
      Supabase free-tier auth limits are comfortable, then stop worrying about this.
- [ ] Supabase free projects pause after ~7 days idle; the daily cron keeps it warm, but
      confirm that's actually true in the dashboard before relying on it.
- [ ] GitHub Issues is already enabled — point testers at it as the feedback channel.

### LinkedIn launch

- [ ] Screenshots (2–4) and a short screen-recording GIF of the swipe + notification flow.
- [ ] Put screenshots and a download badge at the top of the root README — for anyone
      arriving from LinkedIn, that README _is_ the landing page.
- [ ] Update the `GJanos` profile README entry with the release link.
- [ ] Pin the repo on the GitHub profile.

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
