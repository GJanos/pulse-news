# cron/

All slices landed on `develop`. Vercel cron jobs: fetch (Perplexity) → rank (Claude) → persist (Supabase) → notify (FCM).

## Dev commands

```bash
cd cron
npx tsc --noEmit
npm test
npm run test:coverage
npx eslint --ext .ts src
```

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

## Test strategy

Unit-test: ranking, deduplication, text utilities, URL filtering.
Skip: integration tests that need live API keys — run manually via `e2e/` runners.
Coverage target: 60–70% on logic that breaks silently.
