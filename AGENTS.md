# Pulse News — CLAUDE.md

## Repo layout

```
pulse-news/
├── shared/     ← types, config, region constants (no package.json; compiled by consumers)
├── app/        ← React Native / Expo, Android-first
├── cron/       ← Vercel cron jobs, Node.js
└── supabase/   ← schema reference only (no code)
```

## Build & test commands

| Package | Typecheck                     | Lint                                      | Test                       |
| ------- | ----------------------------- | ----------------------------------------- | -------------------------- |
| cron    | `cd cron && npx tsc --noEmit` | `cd cron && npx eslint --ext .ts src`     | `cd cron && npm test`      |
| app     | `cd app && npx tsc --noEmit`  | `cd app && npx eslint --ext .ts,.tsx src` | deferred to app/foundation |

Prettier (run from root): `npm run format:check` / `npm run format`

## Branching

```
main      ← protected; merges from develop only; tagged releases
develop   ← protected; all feature slices merge here; CI must be green
feat/*    ← one slice per branch
fix/*     ← one bug per branch (post-parity only)
```

Never commit directly to `main` or `develop`. Always open a PR.

## Slice discipline

- **One slice = one PR to `develop`.**
- Match legacy behavior exactly — same inputs, same outputs. Structural improvements (renaming, extracting helpers) are allowed. Algorithm changes are not — defer them to `todo.md`.
- Before opening a PR: `/code-review`.
- On slices touching auth, notifications, API endpoints, or deep links: `/security-review`.
- PR description must link the legacy file(s) it replaces.
- Tests in the same PR. Target 60–70% line coverage on logic that breaks silently.

## Legacy reference

Legacy codebase: `/home/hp/projects/pulse-news-legacy/`

When starting a slice: read the corresponding legacy file first, then port behavior exactly.
Do not delete the legacy repo until parity is declared and `v1.0.0` is tagged.

## Shared imports

```typescript
import type { Headline } from '@shared/types';
import { REGIONS } from '@shared/regions';
```

`@shared/*` resolves to `../shared/src/*`. Configured via `paths` in each `tsconfig.json` and `moduleNameMapper` in each `jest.config.cjs`.

## No npm workspaces

Run `npm install` inside each package directory independently.
Root `npm install` installs only shared devtools (Prettier, ESLint, Husky).

## Available skills

The following Claude Code skills are installed and should be invoked when their domain is relevant:

| Skill                 | Invoke when                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| `typescript-pro`      | Typing, generics, branded types, tsconfig, discriminated unions                |
| `react-expert`        | React 18+ components, hooks, Suspense, Server Components                       |
| `react-native-expert` | Expo/RN navigation, native modules, FlatList perf, SafeArea, platform code     |
| `test-master`         | Writing or reviewing tests, coverage gaps, mocking strategy, test architecture |
| `security-reviewer`   | Slices touching auth, API endpoints, notifications, deep links                 |
| `debugging-wizard`    | Investigating errors, stack traces, unexpected behavior                        |
| `code-reviewer`       | Pre-PR quality pass (complements `/code-review`)                               |

During porting slices, these skills are authoritative on code quality within behavioral constraints — see REBUILD_PLAN.md §8.

**Rule: always invoke the relevant skill via the `Skill` tool before writing code in its domain.** Knowing the patterns is not a substitute — skills may have evolved and must be read fresh. If multiple domains are involved (e.g. TypeScript + tests), invoke both before starting.

---

## Post-merge branch cleanup

After any PR is merged, immediately run:

```bash
git checkout develop
git pull origin develop
git branch -d feat/<branch-name>
git push origin --delete feat/<branch-name>
```

Also clean up any other stale merged `feat/*` branches at the same time. Do this without being asked.

---

## Context-mode

Use `ctx_execute` / `ctx_execute_file` / `ctx_batch_execute` (context-mode MCP tools) instead of Bash for any command that reads, queries, lists, diffs, tests, builds, or inspects output.

Bash is only for: file mutations (`mkdir`, `mv`, `cp`, `rm`), git writes (`add`, `commit`, `push`, `checkout`, `branch`, `merge`), navigation (`cd`, `pwd`), process control, package install, and `echo`.

When uncertain → use context-mode. Every KB of unnecessary output reduces session quality.

---

## CI

GitHub Actions runs on every PR to `develop` or `main`:

- format:check (root)
- lint (root, covering all packages)
- typecheck per package
- jest (cron)
