# Pulse — Todo

## V1

- swiping motings are too sensitive they should only fire when user swipes not in the middle but towards to the sides at least

- i need images in the digest page, to increase user retention

# bugs

Root Cause Analysis: The .5s Lag
Your observation:

when going dt → d(t-1) → dt → settings, settings sits blank for .5s until interactive

My Assessment:

The lag is not caused by:

❌ Settings screen not being mounted (now fixed)
❌ Reanimated worklet warnings (already fixed)
❌ ScrollView responsiveness (paging is handled UI-thread side)
Likely causes:

RegionPicker initialization — On first touch, useEffect in RegionPicker re-sorts orderedRegions; React re-renders RegionSection × N regions
CurrencyPicker first open — Currency picker may do async work (lookup, format) on first interaction
FlatList computation — listData and indexMapRef in DigestPage are computed on first mount; if many regions/headlines, this JS work blocks the thread

# bugs

LOG 2026-06-06T09:09:45.950Z DEBUG (digests) multiGet: 9/9 cache hits for 2026-06-04
LOG 2026-06-06T09:09:45.951Z INFO (useGlobalHeadlines) fetching global headlines for 2026-06-04
LOG 2026-06-06T09:09:45.952Z INFO (digests) loading global headlines for 2026-06-04
LOG VirtualizedList: You have a large list that is slow to update - make sure your renderItem function renders components that follow React performance best practices like PureComponent, shouldComponentUpdate, etc. {"contentLength": 12446.857421875, "dt": 780, "prevDt": 132991}

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

- [ ] Notifications are often missed due to Android issues

### UI & Polish

- [ ] Lock vertical screen orientation while using the app

### Behaviour

- [ ] Android swipe navigation should be disabled because it interferes with app gestures
  - When an article is opened in the browser or via the "Open Article" button, enable left-swipe back navigation again

- [ ] refactor costs logging in cron. Have normal log lines like before, but they also need to be refactored, but the main thing is I would love for a run to create a large json object of the data being logged in a format that is transmittable via http, but we kind of already have that, just it needs improvements

### Deferred / Research

- [ ] Record user usage statistics for metrics and analysis _(see GDPR section under Go Live)_ #referencing the gdpr section
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

---

## Business Model

Pro deepsearch model runs for potential VIP tier users — would ~10x costs, so need users first.

**Cost estimate per active user per day:** Perplexity (~9 regions × $0.005) + Anthropic ranking ($0.002) ≈ $0.05/day = ~$18/year. Before Supabase, Firebase, and hosting.

**Recommendation — Freemium:**

- Free: today only, 3 regions max, no global headlines, no history
- Premium ($2.99/month or $19.99/year): all regions, global headlines, full history, tune mode, currency rates, custom notify time

At $20/year, API costs are covered at ~1,000 active users and profitable beyond that.
