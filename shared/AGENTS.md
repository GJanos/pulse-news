# shared/

Source of truth for types, config schema, region constants shared between `app/` and `cron/`.

Consumed two ways:

- **app/** — as the real package `@pulse/shared` (declared `file:../shared`, symlinked into `app/node_modules`). Metro resolves it via the `exports` map in `package.json`; TS/Jest mirror it with `@pulse/shared/*` path mappings. Import as `@pulse/shared/regions`, `@pulse/shared/config`, `@pulse/shared/pulse.config.json`.
- **cron/** — still via the `@shared/*` TS path alias (resolved by cron's own tsconfig `paths` + Jest mapper + Vercel build). `pulse.config.json` is loaded at runtime with `fs.readFileSync`, not imported.

The `package.json` here carries only metadata + the `exports` map (zero dependencies); it does not affect cron's `@shared/*` resolution.

## Rules

- No imports from `app/` or `cron/`. Zero runtime dependencies.
- Types/constants used by both packages belong here; single-consumer things belong in that package.
