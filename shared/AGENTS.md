# shared/

Source of truth for all types, config schema, region/currency constants, and utilities shared between `app/` and `cron/`.

## Rules

- No imports from `app/` or `cron/` inside `shared/`. It has zero runtime consumers in its own dependency graph.
- If a type or constant is used by both packages, it belongs here. If it is used by only one, it belongs in that package.
- `shared/` has no `package.json`. It is not a standalone package. Both consumers compile it directly via the `@shared/*` TS path alias.

## Import pattern

```typescript
import type { Headline } from '@shared/types';
import { REGIONS } from '@shared/regions';
```

Alias `@shared/*` resolves to `../shared/src/*`. Configured in each package's `tsconfig.json` `paths` and `jest.config.cjs` `moduleNameMapper`.

## Contents (added by slices)

- `src/types.ts` — shared TypeScript types (Headline, Digest, Region, UserPreferences …)
- `src/regions.ts` — region code constants and metadata
- `src/config.ts` — pulse.config.json loader and schema
- `pulse.config.json` — runtime config (regions, fetch params, scheduling, log level)

## Tooling assumptions

- Superpowers methodology is in use. Default workflow per slice:
  `/superpowers:write-plan` → review → `/superpowers:execute-plan` → `/code-review` → PR.
- The TypeScript Pro and React Native Expert skills auto-trigger on relevant
  prompts. If they aren't picking up, name them explicitly.
- context-mode is active. Tool outputs >5KB are sandboxed automatically;
  don't ask for raw `cat` of big files — use ctx_search / ctx_execute instead.
