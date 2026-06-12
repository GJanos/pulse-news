# Pulse — Todo

## V1

> 2026-06-11: the items below landed on the `fable` integration branch (PRs #33–#38);
> grouping/evaluation in `docs/superpowers/plans/2026-06-11-fable-todo-groups.md`.
> Merge `fable` → `develop` when the on-device check passes.

### Open

- Left-hand / small-hand ergonomics — assessment with ranked candidates in `docs/ux/left-hand-ergonomics.md`; next step is the bottom-corner back affordance in the reader, after on-device validation
- Variance oversight (LLM judge that re-runs bad digests) — **deferred**: costly and hard to tune. Deterministic levers shipped first (hard `search_domain_filter`, day-only recency, temperature 0.2). The daily-digest workflow now uploads each run's quality log as an artifact — collect 1–2 weeks and revisit; a cheap deterministic gate (image %, domain-match %) can ride on Phase 2's structured run log
- Native ads research — from a business perspective, investigate native/sponsored content ads as an alternative to banner ads

### Done (on `fable`)

- ~~"Custom sound 'default' not found" on-device error~~ — channel input treats any string (even `'default'`) as a custom res/raw filename and creates the channel **silent**; fixed by omitting `sound` (= system default). Affected dev installs need app data cleared / reinstall — channel sound is locked after first creation (`fable-review-fixes`)

- ~~Stale today-date after notification open~~ — root cause: `DigestPage` memoized its date on `[dayIndex]` only; fixed with `useTodayISO()` foreground rollover (#34)
- ~~Sources bad / outdated (Hungary, UK paywalled)~~ — curated sources are now a hard Perplexity `search_domain_filter` allowlist for the first 2 retry rounds (the prompt hint was routinely ignored); Hungary += portfolio.hu, index.hu (#33)
- ~~Retry days should remain day day day day, not week~~ — recency sequence is day-only (#33)
- ~~Storage compression~~ — **rejected as compression**: 2 weeks of digest JSON is <1MB in MMKV; the 261MB is the expo-image disk cache of full-res og:images. Shipped Settings → Storage → "Clear image cache" (#38); the durable fix stays Phase 3 (400px WebP in a bucket)
- ~~Summary toggle~~ — `showSummaries` pref + Settings row (#35)
- ~~Source name open icon~~ — made functional: opens the original article per `openLinksIn`; also wired on the ArticleScreen hostname row (#35, #36)
- ~~Image viewer~~ — pinch/pan/double-tap viewer on the article hero; zoom fix: RNGH needs its own root view inside Modal (#35, #36)
- ~~Calendar day view~~ — month-grid picker on the day-header date, bounded to the history window (#35)
- ~~Swipe-left accidental settings entry~~ — 600ms cooldown after settling on a day page before a swipe can enter settings (#36)
- ~~Larger swipe + dead zone~~ — 72px / 0.6 velocity / ±22px article dead zone, centralized in `utils/swipe.ts` (#36)
- ~~Vercel cron → GitHub Actions~~ — jobs moved to `cron/jobs/`, ts-node runner, explicit exits, quality-log artifact, vercel.json removed (#37)

### Server-side plan

> Refined for hand-off to a brainstorming agent. Phases ordered by dependency:
> 0→1 are "just do it", 2→3 are understood enhancements, 4 needs real brainstorming.

**Phase 0 — Deploy (unblocks everything else)** _(updated 2026-06-11: scheduled jobs moved to GitHub Actions, PR #37)_

- [x] Scheduled jobs run as GitHub Actions workflows: `daily-digest.yml` (06:00 UTC) and `notify.yml` (every 30 min), executing `cron/jobs/*.ts` via ts-node; `vercel.json` deleted
- [ ] Set GitHub repo **Actions secrets**: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (literal `\n`), `PERPLEXITY_API_KEY`, `ANTHROPIC_API_KEY` — then trigger each workflow once via `workflow_dispatch` to smoke-test
- [ ] `/api/account` (server-side device registration) still needs an HTTP host — deploy `cron/` to Vercel for that one route (with `CRON_SECRET` no longer needed), or move it to a Supabase Edge Function; then set `EXPO_PUBLIC_API_URL` in `app/.env`
  - `cron/index.ts` stays the local test runner (all devices, no time filter)
- Caveats (documented in the workflows): GH schedules are best-effort (5–15 min delays; a notify delay across a half-hour boundary skips that window) and auto-disable after 60 idle days
- _Open Q: how to smoke-test cron in prod without spamming real devices?_

**Phase 1 — Harden what's deployed**

- [ ] Tighten `devices` table RLS — replace `USING (true)` / `WITH CHECK (true)` with `user_id = auth.uid()`, or make `/api/account` the only writer and lock the table down
- _Open Q: do clients ever write `devices` directly, or can the route be the sole writer?_

**Phase 2 — Observability: cost logging refactor**

- [ ] Keep human-readable log lines, but have each cron run emit one structured JSON object of all logged/cost data, shaped for HTTP transmission (~80% there; needs a consistent schema + cleanup)
- _Open Q: where does the JSON go — route response, Supabase table, or external sink? That drives the schema._

**Phase 3 — Image durability (server-side proxy/cache)**

Client caching (expo-image) is already solved; this is purely source-URL rot.

- [ ] During the pipeline: download each `og:image`, resize (~400px WebP), upload to a Supabase Storage bucket, store the permanent bucket URL in `imageUrl`
  - Solves URL rot (articles 404 after days), 2–3MB image sizes, hotlink 403s. ~50–100 imgs/day ≈ trivial cost (free tier 1GB)
- _Open Q: resize/encode in Node cron (sharp) vs. Supabase image transform; plus a backfill + eviction policy alongside existing `db.evict`._

**Phase 4 — Usage statistics collector (new component, research-y)**

- [ ] Component to record usage stats (articles read, time in app) + handle device-registration deletion cleanup
  - Lawful basis = "legitimate interests" (no consent popup) **if** Privacy Policy discloses it; keep aggregate/pseudonymous (userID + articleID + timestamp)
- _Open Q: event schema, collection path (app → `/api/...` → Supabase), and retention — the real brainstorm candidate._

### Deferred / Research

- [ ] Record user usage statistics for metrics and analysis _(see GDPR section under Go Live; overlaps Phase 4 above)_
- [ ] Start using bun as a package manager

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

---

## V2

- [ ] **Sources filtering**

- [ ] **Topic filtering** — user selects preferred/suppressed categories (economy, politics, sports…)

- [ ] **Pulse weekly** — clickable grey down-pointing caret next to "Pulse Daily"; dropdown for daily/weekly/monthly digest
  - Daily: ready; weekly = same call with `recency: week`; monthly = `recency: month`

- [ ] **iOS push notifications** — FCM needs an APNs key from Apple Developer account uploaded to Firebase (Project Settings → Cloud Messaging → Apple app config → APNs Authentication Key). Requires paid Apple Developer account ($99/yr). Defer until ready to test on a real iOS device.

- [ ] **Language / translation** — setting for returned article language; default English (no translation)
  - Cron side: translate the full digest after fetching, store alongside original in Supabase with a `lang` column on the `digests` table
  - Use DeepL (not Claude, not Mistral) — purpose-built for translation, free up to 500k chars/month, better quality than an LLM for most language pairs

- [ ] When clicking currency display data, show a small weekly chart

  > Nice-to-have. Treat as secondary polish after the main digest/notification flow is stable. Implement only if currency data is already available and chart doesn't clutter the screen.

---

## Business Model

Pro deepsearch model runs for potential VIP tier users — would ~10x costs, so need users first.

**Cost estimate per active user per day:** Perplexity (~9 regions × $0.005) + Anthropic ranking ($0.002) ≈ $0.05/day = ~$18/year. Before Supabase, Firebase, and hosting.

**Recommendation — Freemium:**

- Free: today only, 3 regions max, no global headlines, no history
- Premium ($2.99/month or $19.99/year): all regions, global headlines, full history, tune mode, currency rates, custom notify time

At $20/year, API costs are covered at ~1,000 active users and profitable beyond that.
