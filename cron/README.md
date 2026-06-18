# Pulse — Cron Pipeline

Daily digest pipeline: fetches regional headlines from Perplexity, ranks them with Claude, stores results in Supabase, and fires FCM push notifications to registered devices. Runs as GitHub Actions cron jobs (`.github/workflows/daily-digest.yml`, `.github/workflows/notify.yml`).

---

## Prerequisites

Node.js 20+. Copy `.env.example` to `.env` inside `cron/` and fill in all values.

---

## Install

```bash
cd cron
npm install
```

---

## Dev commands

All commands run from inside `cron/`.

```bash
npm run build           # tsc --noEmit (typecheck)
npm test                # run Jest test suite
npm run test:coverage   # Jest with coverage report
npm run lint            # ESLint on src/
```

E2E runners (call real APIs — require `.env` to be populated):

```bash
npm run e2e:fetch                           # fetch + rank, no DB writes
npm run e2e:full                            # full pipeline: fetch → persist → FCM → quality log
npm run e2e:notify                          # FCM push to all registered devices
npm run e2e:globalRanking                   # re-rank today's Supabase digests globally
npm run e2e:countryRanking -- US GB DE      # per-region rank on selected regions
```

---

## Environment variables

| Variable                | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `PERPLEXITY_API_KEY`    | Perplexity Sonar API key                              |
| `ANTHROPIC_API_KEY`     | Claude API key (headline ranking)                     |
| `SUPABASE_URL`          | Supabase project URL                                  |
| `SUPABASE_SECRET_KEY`   | Service-role key (bypasses RLS)                       |
| `FIREBASE_PROJECT_ID`   | Firebase project ID                                   |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email                        |
| `FIREBASE_PRIVATE_KEY`  | Firebase private key (newlines as `\n` in the string) |

`SUPABASE_PUBLISHABLE_KEY` is not used here — cron uses the secret key directly.

---

## Configuration

Runtime config lives in `shared/pulse.config.json`. See `shared/CLAUDE.md` for the full field reference.

---

## Pipeline

```
loadPulseConfig() → createSource()
  → runFetchPipeline()
      → resolveRegions()
      → fetchDigest() × N  [Promise.allSettled, staggered]
          → Perplexity retry loop  [429/5xx, exponential backoff]
          → parseHeadlines() → URL filter + slug dedup + topic dedup
          → rankHeadlines()  [Claude — per-region reorder]
  → deduplicateAcrossDigests()  [null out images shared across regions]
  → persistDigests()         [upsert to Supabase]
  → rankGlobalHeadlines()    [Claude — cross-region top stories, if enabled]
  → persistGlobalDigest()
  → dispatchFcm()            [FCM multicast]
  → buildRunReport() → formatRunReportSummary() (log line) → persistRunReport()  [→ pipeline_runs]
  → writeRunLog()            [JSONL time-series, only if log.qualityLog]
```

The two cron jobs share `runFetchPipeline`:

- `jobs/daily-digest.ts` runs the full pipeline above, then FCM-pings devices with `notify_at = NULL` ("notify me when the digest is ready").
- `jobs/notify.ts` runs every ~30 min and notifies devices whose `notify_at` falls in `(last_run_at, now]` — a catch-up window so no scheduled device is dropped when the cron fires irregularly.

---

## Run-report observability

Every `daily-digest` run assembles a versioned `RunReport` (`schema: pulse.run.v1`) — the durable, queryable companion to the human-readable log lines. It aggregates region success/failure, headline counts, fetch + ranking token cost, notify outcome, and duration.

- A one-line summary (`formatRunReportSummary`) is logged via Winston.
- The full report is best-effort persisted to `public.pipeline_runs` (`persistRunReport`): columns `run_at`, `status` (`ok`/`partial`), `total_cost_usd`, `total_tokens`, `regions_succeeded`, `regions_failed`, `duration_ms`, plus the whole `report` as JSON. Persistence failures are logged and swallowed — observability never breaks the digest pipeline.

Bump `schema` on any breaking shape change so downstream queries can branch on the version.

---

## Key source files

See `cron/CLAUDE.md` for the full module map.
