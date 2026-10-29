# cron/ — CLAUDE.md

## What this package does

Vercel cron jobs that:

1. Fetch regional headlines from Perplexity Sonar API (parallel, one call per region)
2. Deduplicate and rank headlines (per-region + global, via Claude)
3. Assemble digest JSON and persist to Supabase
4. Ping FCM to notify devices

## Dev commands

```bash
cd cron
npx tsc --noEmit              # typecheck
npm test                      # Jest
npm run test:coverage         # Jest + coverage
npx eslint --ext .ts src      # lint
```

## Module map

Files marked ✓ are landed on `develop`. Unmarked are planned but not yet ported.

| File                          | ✓   | Role                                                                                                 |
| ----------------------------- | --- | ---------------------------------------------------------------------------------------------------- |
| `src/types.ts`                | ✓   | Core types — `RegionHeadline`, `RegionDigest`, `DigestSource`, `DigestUsage`, quality types          |
| `src/config.ts`               | ✓   | Loads + merges `pulse.config.json` with defaults; env overrides; `createSource()`; `checkCronSecret` |
| `src/logging.ts`              | ✓   | Winston logger factory — `initializeLogger`, `getLogger`                                             |
| `src/qualityLog.ts`           | ✓   | `RunConfig`, `RunLog` types; `buildLogPath`, `appendRunLog`                                          |
| `src/prompt.ts`               | ✓   | All 6 prompt builders for fetch, ranking, and global selection                                       |
| `src/fetchNews.ts`            | ✓   | `PerplexitySource` — implements `DigestSource`; retry loop; URL resolution and filtering             |
| `src/lib/perplexityClient.ts` | ✓   | HTTP client with 429/5xx retry                                                                       |
| `src/lib/parseHeadlines.ts`   | ✓   | URL resolution + quality annotation                                                                  |
| `src/lib/urlUtils.ts`         | ✓   | Article URL validation and slug extraction                                                           |
| `src/lib/topicUtils.ts`       | ✓   | Jaccard deduplication, topic spread                                                                  |
| `src/lib/textUtils.ts`        | ✓   | `stripCitations`, `summaryHasUrl`                                                                    |
| `src/index.ts`                | ✓   | Entry point (stub — wired up in cron/api slice)                                                      |
| `src/rankHeadlines.ts`        | ✓   | Per-region Claude reorder + cross-region global selection (cron/rank slice)                          |
| `src/pipeline.ts`             |     | `runFetchPipeline` — staggered `Promise.allSettled` orchestration (cron/api slice)                   |
| `src/regions.ts`              |     | `resolveRegions()` — re-exports `ALL_REGIONS` from `@shared/regions` (cron/api slice)                |
| `src/notify.ts`               |     | `persistDigests`, `persistGlobalDigest`, `dispatchFcm`, `sendNotifications` (cron/notify slice)      |
| `src/bootstrap.ts`            |     | dotenv loader — must be imported first by all runners (cron/api slice)                               |
| `api/daily-digest.ts`         |     | Vercel handler — fetch + persist + global rank + FCM (cron/api slice)                                |
| `api/notify.ts`               |     | Vercel handler — FCM to devices in the current 30-minute window (cron/notify slice)                  |
| `api/account.ts`              |     | Vercel handler — device registration and account deletion (cron/api slice)                           |

## Environment variables

See `.env.example`. Never commit `.env`.

| Variable                | Description                                  |
| ----------------------- | -------------------------------------------- |
| `PERPLEXITY_API_KEY`    | Sonar API key                                |
| `SUPABASE_URL`          | Supabase project URL                         |
| `SUPABASE_SECRET_KEY`   | Service-role key (bypasses RLS)              |
| `FIREBASE_PROJECT_ID`   | Firebase project ID                          |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email               |
| `FIREBASE_PRIVATE_KEY`  | Firebase private key (`\n` literal newlines) |

## Shared imports

```typescript
import type { Headline } from '@shared/types';
```

`@shared/*` → `../shared/src/*`. Configured in `tsconfig.json` and `jest.config.cjs`.

## Vercel deployment

`api/*.ts` files are Vercel serverless functions. Cron schedule defined in root `vercel.json`.

## Test strategy

Unit-test: ranking, deduplication, text utilities, URL filtering.
Skip: integration tests that need live API keys (Supabase, FCM, Perplexity) — run manually with dev runners.
Coverage target: 60–70% on logic that breaks silently.
