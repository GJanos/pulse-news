# Pulse — Todo

## V1

- on article screen the source and open icon should also open up the article when clicked
- in image viewer modal mode, images are not zoom-able

- swiping motions need to be rethinked since people with small hands to dexit and needing to do a right swipe to go back in article and art. reader mode can be challenging for them

- sources sometimes are bad, like hungary received 4/5 non hungarian international coverage news, all of them were quite outdated due to this. UK received most of it's news from BBC that had paywalled content, so a throughout investigation of all sources is needed. So for all supported regions we need to collect reliable non paywalled og:image supporting non-politically aligned sourecs, at least 3...
  - response variance is REALLY high, i mean after the above bad responses I received, I just re-ran the whole thing, and got WAY better results for all countries, hungary got resolved, and I received many pictures, great content, and I changed nothing. This is really bugging me because I just want to let go and let all my runs be handled automatically having produced a good outcome each day. I need to figure out a system that can be either : more deterministically good or have oversight on each day's news, like I complete a day's news section, all 5, later 10 articles are ready, then send it over to claude, it identifies if a current countries digests are up to our standards or not, and if it is bad, it keeps the good news maybe/ or just plainly restarts the whole process. But to be honest, tuning this can be hard and COSTLY so I am waiting for other great ideas on this front how to make things more deterministic

- retry days should remain day day day day shit, not week

NEW TODOS (from János chat — translated)

~~Storage compression~~ — **evaluated, rejected as compression.** 2 weeks of digest JSON is <1MB in MMKV (9 regions × 5 headlines × ~1KB × 14 days); the 261MB is the expo-image disk cache holding full-res og:images (1–3MB each). Compressing JSON would save nothing. Shipped instead: Settings → Storage → "Clear image cache". Real fix is server-side Phase 3 (resize to ~400px WebP in a Supabase bucket → ~10–20MB per two weeks, also fixes URL rot).
Summary toggle — summary display in digest page should be configurable via settings
Source name open icon — fix the open icon next to source name: either make it functional (open article) or remove it
Image viewer — tapping a pulled image should open full size with zoom support
Calendar day view — add a calendar-based day picker for browsing history
Swipe-left accidental settings entry — add a small activation delay when swiping left into today's digest, to prevent accidentally entering settings
Larger swipe + dead zone — increase swipe range and dead zone threshold globally
Left-hand ergonomics — reading articles with the left hand is awkward; needs UX review (ties into the small-hand swipe issue in old todos)
Native ads research — from a business perspective, investigate native/sponsored content ads as an alternative to banner ads

### Server-side plan

> Refined for hand-off to a brainstorming agent. Phases ordered by dependency:
> 0→1 are "just do it", 2→3 are understood enhancements, 4 needs real brainstorming.

**Phase 0 — Deploy (unblocks everything else)**

- [ ] Deploy `cron/` to Vercel — project root dir = `cron/`; `vercel.json` (repo root) defines the two schedules
- [ ] Set Vercel env vars:
  - `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
  - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (literal `\n`, not real newlines)
  - `PERPLEXITY_API_KEY`
  - `CRON_SECRET` — random string; Vercel sends `Authorization: Bearer <CRON_SECRET>` per invocation
- [ ] Verify the route split runs on schedule:
  - `GET /api/daily-digest` — fetch + persist + FCM to null-`notify_at` devices (`0 5 * * *`)
  - `GET /api/notify` — FCM to devices in current 30-min window (`*/30 * * * *`)
  - `cron/index.ts` stays the local test runner (all devices, no time filter)
- [ ] Once the deployment URL exists → set `EXPO_PUBLIC_API_URL` in `app/.env` so `POST /api/account` (server-side device registration) goes live
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
