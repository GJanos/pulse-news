# Pulse — Todo

## V1

Remaining V1 polish/behavior, grouped into 3 slices.

### Slice 1 — Currency rates & data freshness

- **Live rates via Frankfurter v2** — replace `@fawazahmed0/currency-api` (jsDelivr/pages.dev) in `app/src/hooks/useCurrencyRates.ts` with `https://api.frankfurter.dev/v2` (no key, ECB-backed). Frankfurter is EUR-based: pass `base=<baseCurrency>` + quote symbols. Keep today-vs-yesterday % change (dated endpoint for prior day).
- **Stop over-eager fetch/save** — refetch prices (and flush prefs) only when the selected region/currency set actually changes, like legacy — not on every settings tweak. Reconcile React Query key + `usePreferences` debounced flush.
- **Empty-digest force refresh** — an empty "today" must not be cached in a way that blocks refetch; force-refresh and notification tap must always repull. Check `useDigest` / `storage/digests.ts`.
- **History-days off-by-one** — `historyDays: N` should mean N days back from today → today + N pages (`7` ⇒ 8 pages). Currently N total pages.

### Slice 2 — Defaults, branding & settings wiring

- **App name → "Pulse News"** (currently "Pulse" in `app/app.json`).
- **Default theme → Dark** (`DEFAULT_PREFERENCES.theme`, currently `light`).
- **App-start loading screen → Dark** (boot/native-splash bg `#fafaf7`; distinct from the post-auth JS SplashScreen).
- **Clamp global headline count** to the shared `cron.api.ranking.global.count` — the Settings stepper currently exceeds it.
- **Global-section stepper spacing** — buttons as close to the number as the "Headlines per region" stepper.
- **Region label: keep `code` option** (decision: keep both flag + code). When showing the ISO code only, nudge it a few px left.

### Slice 3 — Navigation, gestures & UI polish

- **Source ↔ open-icon spacing** on digest entries — a few px gap to match the article screen, **including global top headlines** (`GlobalSection`, `RegionSection`).
- **Android system nav-bar regression** — buttons show by default; restore legacy swipe-to-reveal (immersive/hidden).
- **Screen-switch logging** — restore the gentle legacy log line on screen changes (`logger` + `nav` slice).
- **Swipe right→left on Today opens Settings** via the existing slide-in animation (`useSwipe`).

### Deployment

- [ ] **Set `EXPO_PUBLIC_API_URL`** — once Vercel is deployed, add the deployment URL to `app/.env` so `POST /api/account` (server-side device registration) becomes available
- [ ] **Tighten `devices` table RLS** — current policies use `USING (true)` / `WITH CHECK (true)`, meaning any authenticated user can read/write any device row. Restrict to `user_id = auth.uid()` or move registration through the Vercel `/api/account` route which enforces identity server-side
- [ ] **Vercel deployment** — deploy the two cron API routes to Vercel:
  - Vercel project root directory must be set to `cron/` (dashboard → Settings → General → Root Directory)
  - `vercel.json` at repo root defines the two cron schedules; Vercel reads it from the project root
  - Required env vars (set in Vercel dashboard → Settings → Environment Variables):
    - `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
    - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (store private key with literal `\n`, not real newlines)
    - `PERPLEXITY_API_KEY`
    - `CRON_SECRET` — any random string; Vercel sends `Authorization: Bearer <CRON_SECRET>` on each cron invocation to prevent unauthorized triggers
  - Route split:
    - `GET /api/daily-digest` — fetch + persist + FCM to null-notify_at devices; schedule `0 5 * * *`
    - `GET /api/notify` — FCM to devices in current 30-min window; schedule `*/30 * * * *`
  - `cron/index.ts` remains the local test runner (sends to all devices, no time filtering)

### Bugs

- [ ] slow rendering of digest screen top navigation headline

- [ ] Notifications are often missed due to Android issues

### UI & Polish

- [ ] Lock vertical screen orientation while using the app
- [ ] Swipe navigation should be more sensitive

### Behaviour

- [ ] Android swipe navigation should be disabled because it interferes with app gestures
  - When an article is opened in the browser or via the "Open Article" button, enable left-swipe back navigation again

  > **Notes:** The DigestPager uses RNGH pan for horizontal navigation — left/right edges where Android 10+ wants the system back gesture. Conflict is real. Use `View.systemGestureExclusionRects` (Android only, per-View opt-in). Caveats: max 200dp per edge, newer RN/Expo only. Avoid `setNavigationMode` — requires custom native code.
  >
  > Restoring system edge-swipe-back on the article screen is automatic — just don't apply `systemGestureExclusionRects` there. A JS-level pan-to-close is a separate GestureDetector and more work.

- [ ] Swiping needs to be adjusted again

### Deferred / Research

- [ ] Recurd user usage statistics for metrics and analysis _(see GDPR section under Go Live)_ #referencing the gdpr section
- [ ] Look at claude graphy plugin — codebase graph knowledge builder
- [ ] Start using bun as a package manager
- [ ] "Lets brainstorm on this: There are auto-commit Stop hooks, git guard PreToolUse hooks, and claude-mem's own summary generation — but

  nothing that combines git diff + claude-mem summaries → proposed CLAUDE.md diffs.

  It doesn't exist as a ready-made skill, but it's a very buildable, well-scoped idea. Here's how it would

  actually work:

  The Stop hook script would:

  Run git diff HEAD (uncommitted) + git log --oneline origin/main..HEAD (unpushed commits) to get what

  changed

  Hit claude-mem's HTTP API on localhost:37777 to pull recent session summaries

  Feed both into a local LLM prompt (or Claude SDK if you're okay with that): "Given these code changes and

  what was done this session, what additions/modifications to CLAUDE.md would be useful?"

  Output a unified diff to stdout — which the Stop hook can display for review before you accept/reject

  The tricky parts:

  You'd want the hook to present the diff interactively rather than auto-apply, so it needs to write to a

  temp file and open it, or print clearly to terminal

  CLAUDE.md proposals need to avoid being redundant/noisy — the LLM prompt needs a "only suggest if

  meaningfully new" constraint

  Deciding which of the three git scopes to use (uncommitted / since last commit / since last merge) probably

  wants a config flag"

---

## Go Live

### Store Requirements

- [ ] Privacy Policy hosted at a URL — must name: email, device token, preferences stored in Supabase; third parties Perplexity, Anthropic, Firebase. Link in app (Settings) and store listing
- [ ] Account deletion in-app — Google hard-requires this for any app with accounts
- [ ] Content rating questionnaire (IARC for Play, similar for App Store)
- [ ] Store assets: icon all sizes, 2–8 screenshots, short + long description

**Play Store:**

- [ ] Data Safety form — accurately declare what you collect and share; mismatch with actual behaviour gets you rejected
- [ ] Target SDK 34+ (Android 14)

**App Store:**

- [ ] Apple Developer account ($99/yr)
- [ ] Privacy nutrition labels
- [ ] APNs key for push (see V2 iOS push item)
- [ ] Privacy manifest file if you use certain Apple APIs

### GDPR

Allowed — but you need a lawful basis. For product analytics (which articles get read, time in app), "legitimate interests" covers it without a consent popup, as long as your Privacy Policy discloses it. Aggregate/pseudonymous stats (user ID + article ID + timestamp) = fine with disclosure. Selling or sharing with third parties = needs explicit consent.

- [ ] Right to deletion — account deletion covers this
- [ ] Right to data export — lower priority, rarely enforced for small apps

---

## Extra Features (I need your opinion on whether to implement these or not)

- [ ] When clicking currency display data, show a small weekly chart

  > Nice-to-have. Treat as secondary polish after the main digest/notification flow is stable. Implement only if currency data is already available and chart doesn't clutter the screen.

---

## V2

- [ ] **React Navigation migration** — the rebuild uses manual conditional rendering (keeps settings overlay + DigestPager gesture model intact). Post-parity, evaluate migrating to React Navigation for lazy screen mounting and standard back-gesture handling. Caveats: DigestPager's RNGH pan gesture needs `simultaneousHandlers` config to avoid conflicts with a stack navigator's swipe-back; the settings overlay (both screens mounted at once) becomes either a modal or a custom `CardStyleInterpolator`. Only worth it if deep navigation stacks appear (V2 features).

- [ ] **Sources filtering**
- [ ] **Topic filtering** — user selects preferred/suppressed categories (economy, politics, sports…)
- [ ] **Pulse weekly** — clickable grey down-pointing caret next to "Pulse Daily"; dropdown for daily/weekly/monthly digest
  - Daily: ready; weekly = same call with `recency: week`; monthly = `recency: month`
- [ ] **iOS push notifications** — FCM needs an APNs key from Apple Developer account uploaded to Firebase (Project Settings → Cloud Messaging → Apple app config → APNs Authentication Key). Requires paid Apple Developer account ($99/yr). Defer until ready to test on a real iOS device.
- [ ] **Language / translation** — setting for returned article language; default English (no translation)
  - Cron side: translate the full digest after fetching, store alongside original in Supabase with a `lang` column on the `digests` table
  - Use DeepL (not Claude, not Mistral) — purpose-built for translation, free up to 500k chars/month, better quality than an LLM for most language pairs

## Slice 6 (app/notifications) deferrals

- Replace the publishable-key direct `devices` upsert with a `register-device`
  Supabase Edge Function backed by the secret key (RLS hardening). Carried from
  legacy `register.ts`.
- iOS push support: re-introduce the stripped `registerDeviceForRemoteMessages`
  / provisional-permission paths if/when an iOS target is added.
- Evaluate registering FCM tap handlers exactly once (vs. on each `ready`
  re-entry) if re-login churn ever causes a stale initial-notification re-navigation.

---

## Business Model

Pro deepsearch model runs for potential VIP tier users — would ~10x costs, so need users first.

**Cost estimate per active user per day:** Perplexity (~9 regions × $0.005) + Anthropic ranking ($0.002) ≈ $0.05/day = ~$18/year. Before Supabase, Firebase, and hosting.

**Recommendation — Freemium:**

- Free: today only, 3 regions max, no global headlines, no history
- Premium ($2.99/month or $19.99/year): all regions, global headlines, full history, tune mode, currency rates, custom notify time

At $20/year, API costs are covered at ~1,000 active users and profitable beyond that.
