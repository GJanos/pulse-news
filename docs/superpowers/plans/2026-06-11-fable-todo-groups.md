# Fable Todo Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group, evaluate, and implement the V1 todos from `todo.md` as five focused PRs targeting an integration branch `fable` (cut from `develop`).

**Architecture:** Each group is one branch off `fable` → one PR → merged into `fable`. Cron changes are config/prompt-level (deterministic source filtering); app changes are surgical edits to existing screens/hooks plus three small new components.

**Tech Stack:** React Native (Expo 56), Zustand, MMKV, reanimated 4 + gesture-handler 2, expo-image; cron: Node TS on Vercel, Perplexity Sonar.

---

## Grouping & evaluation

| #   | Group                                                                   | Branch                 | Verdict                                                                         |
| --- | ----------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| A   | Cron source quality & determinism (sources, variance, retry recency)    | `fable/cron-quality`   | **Do** — highest-leverage fixes are deterministic and cheap                     |
| B   | Stale "today" after notification open                                   | `fable/today-rollover` | **Do** — real bug, root cause identified                                        |
| C   | Digest UI features (summary toggle, source tap, image viewer, calendar) | `fable/digest-ui`      | **Do** — all four are reasonable; calendar kept minimal                         |
| D   | Gesture ergonomics (settings dead-zone, thresholds, left-hand)          | `fable/gestures`       | **Do code; left-hand = assessment only**                                        |
| E   | Storage footprint (compression idea)                                    | `fable/storage`        | **Re-scope** — JSON compression is the wrong target; image cache is the culprit |

### Per-item evaluation (what's worth doing, what isn't)

**A1 — retry recency stays `day` (do, trivial).** `recencySequence` is `['day','day','week','week','month','month']` in both `cron/src/config.ts:30` and `shared/pulse.config.json`. Widening to week/month is exactly what produced "quite outdated" Hungary items. Fix: `['day','day','day','day','day','day']`. Trade-off: a region with a slow news day may return < minResults — acceptable; stale news is worse than fewer items, and the parser already tolerates shortfalls.

**A2 — source quality (do, high value).** Root cause: region `sources` are only a _soft prompt hint_ (`buildFetchUserPrompt` says "Preferred outlets: …"); Perplexity is free to ignore it — which is why Hungary got 4/5 international coverage and UK got paywalled content. Fix: pass the curated domains as a hard `search_domain_filter` allowlist in the Perplexity payload for the early retry rounds, dropping the filter on the final rounds as a safety valve (config: `fetch.domainFilterRounds`). Also add `portfolio.hu` + `index.hu` to Hungary so every region has ≥3 non-paywalled og:image-capable outlets.

**A3 — response variance / LLM oversight gate (defer — document only).** Building a Claude judge that re-runs bad digests is costly (≈doubles per-day spend on bad days), hard to tune, and itself non-deterministic. The deterministic levers come first and likely remove most variance: (1) hard domain filter (A2), (2) day-only recency (A1), (3) temperature 0.35 → 0.2 in `pulse.config.json` (sampling variance is part of the run-to-run swing). The existing `qualityLog` already records per-run quality signals; once Phase 2 (structured run JSON) lands, a _cheap_ gate becomes possible: deterministic checks (images present %, domain-match %, dedupe count) that flag a run for manual review rather than auto-rerun. Re-evaluate the LLM judge only if variance persists after A1/A2 ship.

**B — stale today-date (do, root cause found).** `DigestPage.tsx:30` memoizes `date = isoDateAtDayIndex(dayIndex)` with deps `[dayIndex]`. When the app sleeps in the background across midnight (the daily cron runs at 05:00 UTC), the mounted page for dayIndex 0 keeps yesterday's date; the notification tap bumps `digestRefreshNonce` → `forceRefresh()` → refetches _yesterday_. Kill+relaunch remounts and fixes it — exactly the reported symptom. Fix: a `useTodayISO()` hook that re-reads `getTodayISO()` on every AppState `active` transition; add it to the date memo deps in `DigestPage` and to `DayHeader` rendering in `DigestPager`. Also remove the footgun `TODAY_ISO` module constant if unused.

**C1 — summary toggle (do, cheap).** New `showSummaries` pref (default true) + Settings row; `RegionSection`/`GlobalSection` skip the summary `<Text>` when off. Article page keeps its summary block — that page exists to show depth.

**C2 — source open icon (do — make it functional).** `HeadlineFoot` renders source name + a `link` icon that does nothing (`RegionSection.tsx:34-47`, same in `GlobalSection`). Making it functional beats removing it: tap opens the _original article_ respecting `openLinksIn` (in-app reader via `setReaderUrl`, else `openExternalUrl`). This gives a one-tap path to the source without going through the article overlay.

**C3 — image viewer (do).** New `ImageViewerModal` (pinch-zoom + pan + double-tap reset, built on gesture-handler + reanimated — no new dependency). Wired to the hero image in `ArticleScreen`. **Not** wired to digest-list images: tapping those already opens the article; overloading that tap would be a regression.

**C4 — calendar day view (do, minimal).** Tapping the date title in `DayHeader` opens a month-grid modal; only dates within `historyDays` are enabled; selecting calls `setDayIndex`. Custom ~150-line component, no dependency. Nice-to-have but cheap and discoverable.

**D1 — accidental settings entry (do).** Settings is just the page after "today" in the pager, so an overshooting fling lands in settings. Fix: cooldown — if the pager settles on settings within 600 ms of having settled on the today page, bounce back to today. Pure helper `shouldBlockSettingsEntry()` for tests. The header settings button bypasses the cooldown (intentional taps always work).

**D2 — larger swipe + dead zone (do, conservative).** Raise `SWIPE_DISTANCE` 48→72 px, `SWIPE_VELOCITY` 0.45→0.6, article pan `activeOffsetX` ±15→±22, reader edge strip 5→8. Conservative bumps; numbers live in `utils/swipe.ts` so further tuning is one-line.

**D3 — left-hand ergonomics (assessment only — no code).** Real UX work needs device testing with the user's hands; blind code changes risk making it worse. Deliverable: written assessment with concrete candidate changes (see `docs/ux/left-hand-ergonomics.md` in Group D).

**E — storage compression (re-scope; compression = bad idea).** 2 weeks ≈ 261 MB cannot be digest JSON: 9 regions × 5 headlines × ~1 KB × 14 days ≈ **<1 MB** in MMKV. The bulk is the expo-image disk cache holding full-resolution og:images (1–3 MB each, the todo itself notes 2–3 MB images). Compressing JSON would save nothing and add latency/complexity — rejected. What actually helps: (1) **now**: a "Clear image cache" row in Settings (`Image.clearDiskCacheAsync()`), (2) **real fix**: server-side Phase 3 from the existing plan — resize to ~400 px WebP in a Supabase bucket, which shrinks two weeks of images to ~10–20 MB _and_ fixes URL rot. E ships the settings row + records the evaluation; Phase 3 stays in the server-side plan.

---

## Execution order

A (cron, isolated) → B (small app fix) → C (app UI) → D (app gestures) → E (app settings row + docs). Each: branch off `fable`, implement w/ tests, typecheck+lint+test, PR → `fable`, merge, delete branch.

---

### Task 0: Create `fable` integration branch

- [ ] `git checkout develop && git pull origin develop`
- [ ] `git checkout -b fable && git push -u origin fable`
- [ ] Commit this plan doc to `fable`.

### Task A: `fable/cron-quality`

**Files:**

- Modify: `cron/src/config.ts` (recencySequence, domainFilterRounds default)
- Modify: `shared/src/config.ts` (FetchConfig.domainFilterRounds)
- Modify: `shared/pulse.config.json` (recencySequence, domainFilterRounds, temperature)
- Modify: `shared/src/regions.ts` (Hungary sources)
- Modify: `cron/src/fetchNews.ts` (buildPayload: search_domain_filter; pass round)
- Test: `cron/src/tests/fetchNews.test.ts`, `cron/src/tests/config.test.ts`

Steps:

- [ ] Add `domainFilterRounds: number` to `FetchConfig`; default 2 in `defaultConfig`; set in pulse.config.json.
- [ ] `recencySequence: ['day','day','day','day','day','day']` in both default + json. Temperature 0.35 → 0.2 in json.
- [ ] In `fetchNews.ts`: extract `domainsFromSources(sources)` (parse `(domain.tld)` parens); in `buildPayload`, when `round < domainFilterRounds && domains.length`, add `search_domain_filter: domains`.
- [ ] Hungary sources += `Portfolio (portfolio.hu)`, `Index (index.hu)`.
- [ ] Tests: payload includes filter on round 0/1, omits on round ≥ domainFilterRounds; config merge picks up new key; regions test (each region ≥3 sources with parseable domains).
- [ ] `cd cron && npx tsc --noEmit && npx eslint --ext .ts src && npm test`; PR → fable; merge.

### Task B: `fable/today-rollover`

**Files:**

- Create: `app/src/hooks/useTodayISO.ts`
- Modify: `app/src/components/DigestPage.tsx:30`, `app/src/components/DigestPager.tsx` (DayHeader), `app/src/data.ts` (drop TODAY_ISO if unused)
- Test: `app/src/tests/hooks/useTodayISO.test.ts`

Steps:

- [ ] Hook: `useState(getTodayISO)`; AppState listener on `change` → if `active` and `getTodayISO() !== prev`, set state.
- [ ] `DigestPage`: `const todayISO = useTodayISO();` add to date memo deps.
- [ ] `DigestPager`/`DayHeader`: pass `todayISO` prop so the memoized header re-renders past midnight.
- [ ] Tests with mocked AppState emitting `active` after a date change (mock `getTodayISO` via jest spy or Date).
- [ ] `cd app && npx tsc --noEmit && npx eslint --ext .ts,.tsx src && npm test`; PR → fable; merge.

### Task C: `fable/digest-ui`

**Files:**

- Modify: `app/src/types.ts` (+`showSummaries`), `app/src/storage/preferences.ts` (default true)
- Modify: `app/src/screens/SettingsScreen.tsx` (Reading group row)
- Modify: `app/src/components/RegionSection.tsx`, `app/src/components/GlobalSection.tsx` (gate summary; pressable source row)
- Create: `app/src/utils/openArticleUrl.ts` (respects `openLinksIn`)
- Create: `app/src/components/ImageViewerModal.tsx`; wire in `app/src/screens/ArticleScreen.tsx` hero
- Create: `app/src/components/CalendarModal.tsx` (+ pure helpers `calendarDays(todayISO, historyDays)`); wire DayHeader date title press
- Tests: prefs default, RegionSection summary gating, calendar helpers, openArticleUrl routing

Steps:

- [ ] `showSummaries` pref end-to-end (type, default, settings Switch, gate `<Text>{h.summary}</Text>` in both sections).
- [ ] `openArticleUrl(url)`: reads store — `openLinksIn === 'in-app'` → `setReaderUrl(url)` else `openExternalUrl(url)`. Source row in `HeadlineFoot`/`GlobalSection` becomes Pressable → `openArticleUrl(h.url)`.
- [ ] `ImageViewerModal`: full-screen Modal, pinch (scale clamp 1–4), pan when zoomed, double-tap toggle 1↔2.5, single-tap/swipe-down close. ArticleScreen hero wrapped in Pressable → opens viewer.
- [ ] `CalendarModal`: month grid of current month (back-nav for older months within history range); enabled iff `0 ≤ dayIndexFor(date) ≤ maxDayIndex`; select → `setDayIndex`, close. DayHeader date title becomes Pressable.
- [ ] App checks + tests; PR → fable; merge.

### Task D: `fable/gestures`

**Files:**

- Modify: `app/src/utils/swipe.ts` (constants), `app/src/screens/ArticleScreen.tsx:83`, `app/src/screens/ArticleReader.tsx:103`
- Modify: `app/src/components/DigestPager.tsx` (settings cooldown + pure helper)
- Create: `docs/ux/left-hand-ergonomics.md`
- Tests: `app/src/tests/utils/swipe.test.ts` (new thresholds), DigestPager helper test

Steps:

- [ ] SWIPE_DISTANCE 72, SWIPE_VELOCITY 0.6; activeOffsetX ±22 (article), 8 (reader strip). Fix tests.
- [ ] `shouldBlockSettingsEntry(now, lastDaySettleAt, cooldown=600)`: in `onMomentumScrollEnd`, when target is settings and blocked → scroll back to today, skip `setScreen`. Update `lastDaySettleAt` on day settles.
- [ ] Left-hand assessment doc.
- [ ] App checks + tests; PR → fable; merge.

### Task E: `fable/storage`

**Files:**

- Modify: `app/src/screens/SettingsScreen.tsx` (Storage group: Clear image cache row)
- Modify: `todo.md` (replace compression todo with evaluation outcome)

Steps:

- [ ] Settings row calls `Image.clearDiskCacheAsync()` + `clearMemoryCacheAsync()` (expo-image), with a "Cleared" confirmation state.
- [ ] Record evaluation (compression rejected; Phase 3 is the fix) in todo.md.
- [ ] App checks; PR → fable; merge.

### Task F: Finalize

- [ ] All five PRs merged into `fable`; delete group branches (local + origin).
- [ ] Update `todo.md`: mark done items, fold in A3/D3/E evaluations.
- [ ] Final summary (and handover doc if session limit nears).
