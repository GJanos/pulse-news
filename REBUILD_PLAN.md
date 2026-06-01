# Pulse Rebuild Plan

Date: 2026-05-23
Owner: Janos Gorondi
Status: Approved — ready to execute

This document is the agreed plan for rebuilding the Pulse codebase in a fresh repository with proper tooling, structure, and per-slice discipline.

The rebuild is **structural, not behavioral**. The output of the rebuilt code on the same input must match the legacy code. Algorithm changes and feature additions are out of scope until parity is reached.

---

## 1. The legacy tree

Do not delete the existing repo. It is the reference implementation. Every rebuilt slice will be diffed against it.

Mechanics:

1. Finish and commit the current WIP on the legacy repo. Push.
2. Commit this `REBUILD_PLAN.md`, the consolidated `BEHAVIOR.md`, the parity snapshot in `todo.md`, and the `devlog.md` rebuild entry. Push.
3. Close Claude Code.
4. Rename the directory: `D:\JanosGorondi\AI\pulse-news` → `D:\JanosGorondi\AI\pulse-news-legacy`.
5. Create empty `D:\JanosGorondi\AI\pulse-news` next to it.
6. On GitHub, create a new empty repo (e.g. `pulse-news-rebuild`).
7. In PowerShell:
   ```
   cd D:\JanosGorondi\AI\pulse-news
   git init
   git remote add origin <new-repo-url>
   git checkout -b main
   git checkout -b develop
   ```
8. Launch Claude Code in `D:\JanosGorondi\AI\pulse-news`, and add `D:\JanosGorondi\AI\pulse-news-legacy` as an additional working directory (`/add-dir` or `--add-dir` flag).
9. First task in the new session: scaffold tooling (Phase 0 below).

---

## 2. Behavior spec (BEHAVIOR.md)

The three existing README files already act as behavior documentation. Consolidate and correct them into one `BEHAVIOR.md` at the new repo root, plus per-package READMEs that focus on setup/dev workflow.

`BEHAVIOR.md` is the acceptance test for "is the rebuild caught up yet?" It must list, in flat bullet form (not implementation detail):

- Every screen in the app and what it does.
- Every cron job step and what it produces.
- Every config key in `pulse.config.json`.
- Every Supabase table and its purpose.
- Every deep link the app responds to.
- Every notification type the app sends.
- Every preference the user can set.

It does not describe how anything is implemented. Implementation lives in code and CLAUDE.md files.

---

## 3. WIP snapshot (todo.md)

Before any rebuild work starts, snapshot the current state of in-flight work into `todo.md`:

- The fixes already in the modified files (must land in the rebuild, not regress).
- The new hooks and components added but not yet committed.
- Any known bugs not yet fixed.
- Any features in flight.

Every rebuild slice must check this list and incorporate the relevant items. The list is the parity contract.

---

## 4. Repository structure

```
pulse-news/
├── .github/workflows/ci.yml        ← lint + typecheck + test on every PR
├── .husky/                          ← pre-commit hook
├── .gitignore
├── .prettierrc
├── .eslintrc.cjs                    ← root config, extended by subpackages
├── tsconfig.base.json               ← shared compiler options
├── README.md                        ← humans: high-level overview
├── BEHAVIOR.md                      ← humans + Claude: the spec
├── REBUILD_PLAN.md                  ← this file
├── devlog.md
├── todo.md
├── CLAUDE.md                        ← Claude: repo-wide conventions, build/test, branching
├── CODEOWNERS
├── shared/                          ← not a standalone package; consumed via relative imports
│   ├── CLAUDE.md                    ← Claude: shared is source of truth, no app/cron imports allowed in here
│   ├── pulse.config.json
│   └── src/                         ← config loader, shared types, constants
├── app/
│   ├── README.md                    ← humans: Expo dev setup
│   ├── CLAUDE.md                    ← Claude: RN/Expo specifics, gotchas
│   ├── package.json
│   ├── tsconfig.json                ← extends ../tsconfig.base.json
│   ├── .eslintrc.cjs                ← extends ../.eslintrc.cjs
│   └── src/
└── cron/
    ├── README.md                    ← humans: Vercel/Supabase setup, env vars
    ├── CLAUDE.md                    ← Claude: cron specifics, scheduling, env vars
    ├── package.json
    ├── tsconfig.json
    ├── .eslintrc.cjs
    └── src/
```

No npm workspaces. Two consumers of `shared/` is not enough to justify the tooling tax. Imports use relative paths or a TS path alias. If a third consumer appears, revisit.

---

## 5. Tooling baseline (Phase 0 — before any feature code)

Land all of this before slice 1:

- ESLint + `@typescript-eslint` — root config, subpackages extend.
- Prettier — root config, one style for the whole repo.
- TypeScript — `tsc --noEmit` per package, shared `tsconfig.base.json`.
- Jest + `ts-jest` — already started in `cron/`, formalize and extend to `app/`.
- Husky + lint-staged — pre-commit: format + typecheck staged files.
- GitHub Actions — on every PR to `develop`: install, lint, typecheck, test.
- Branch protection on `main` and `develop`: require PR, require CI green.
- CODEOWNERS — Janos as owner of everything.

---

## 6. Branching

```
main      ← protected, only receives merges from develop, tagged releases
develop   ← protected, integration branch, all slices merge here first
feat/*    ← short-lived, one slice each
fix/*     ← short-lived, one bug each (used after parity is reached)
```

No `release/` branch until a beta channel exists.

---

## 7. Slices

### Backend slices (in order — each builds on the prior)

| #   | Slice                                                                                          | Status              | PR  |
| --- | ---------------------------------------------------------------------------------------------- | ------------------- | --- |
| 1   | **shared** — types, config schema, region/currency constants                                   | ✓ merged to develop | #1  |
| 2   | **cron/config** — loading + validating `pulse.config.json` from `shared/`                      | ✓ merged to develop | #2  |
| 3   | **cron/fetch** — news fetching, all sources, logging (`logging.ts`, `qualityLog.ts`)           | ✓ merged to develop | #3  |
| 4   | **cron/rank** — per-region Claude reorder + cross-region global selection                      | ✓ merged to develop | #4  |
| 5   | **cron/notify** — `persistDigests`, FCM dispatch, `sendNotifications`                          | ✓ merged to develop | #5  |
| 6   | **cron/api** — `daily-digest.ts` + `notify.ts` + `account.ts` Vercel handlers, pipeline wiring | ✓ merged to develop | #6  |

Currency rate fetching happens in the UI, not in cron — no `cron/currency` slice.

### Frontend slices (after backend lands on develop)

| #   | Slice                                                                                                     | Status              | PR  |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------- | --- |
| 1   | **app/foundation** — App.tsx shell, Zustand store skeleton, boot state machine, fonts, themes, safe areas | ✓ merged to develop | #8  |
| 2   | **app/auth-flow** — Supabase auth + login/signup/reset screens + session hook                             | ✓ merged to develop | #9  |
| 3   | **app/digest-flow** — digest fetching + currency rates + DigestPage + DigestPager + sections              | ✓ merged to develop | #10 |
| 4   | **app/settings-flow** — Settings screen + region picker + preference editing                              | ✓ merged to develop | #12 |
| 5   | **app/article** — ArticleScreen + WebBrowser handoff                                                      | ✓ merged to develop | #13 |
| 6   | **app/notifications** — notification registration + deep link parsing + password recovery flow            | pending             |     |

Some files (App.tsx, the store) get touched across multiple slices. That is expected. Each slice adds the parts of those files it needs; it does not rewrite from scratch.

### Cross-slice dependency notes

**Slice 4 → Slice 6: `notificationsEnabled`**
`SettingsScreen` shows a "Notifications disabled — tap to open system settings" banner controlled by `notificationsEnabled`. The real value comes from `useDeviceRegistration` which is slice 6. Slice 4 must add a stub `device` Zustand slice with `notificationsEnabled: false` so the banner is visible and testable from day one. Slice 6 replaces the stub with real FCM registration and updates the slice to the live value. **Do not hardcode `true` or hide the banner — the stub approach keeps the wiring honest.**

Each slice kickoff prompt explicitly scopes the legacy regions to port. Example:

> "Slice: app/auth-flow. Legacy reference: `legacy/app/src/screens/LoginScreen.tsx`, `legacy/app/App.tsx` lines 45–80 (auth provider wiring), `legacy/app/src/hooks/useSupabaseAuth.ts`. Port these, ignore the rest of App.tsx for this slice."

---

## 8. Frontend architecture decisions

These decisions were made before app/foundation was written. **Do not revisit without re-reading this section in full.**

---

### 8.1 State: Zustand + React Query

The frontend uses **Zustand** for all synchronous global state (nav, prefs, auth session) and **React Query** for all async server data (digest payloads, global headlines, currency rates). Plain React Context is not used for app-wide state.

#### Why not prop-drilling (legacy approach)

The legacy `App.tsx` passes `theme`, `aes`, and the full `UserPreferences` object as props into `DigestPager → DigestPage → RegionSection`. Every `setPref` call creates a new `UserPreferences` object (spread + bumped `updatedAt`). That new reference breaks `React.memo` on `DigestPager` and `DigestPage`, causing them to re-render on every settings keystroke — including re-running `useDigestPageData` with its `sortedSelectedRegions` and three `useMemo` chains.

The legacy fix was the **digestPrefs freeze**: `App.tsx` maintains a frozen snapshot of prefs and passes it to `DigestPager` while settings is open. This is a band-aid. Zustand selectors remove the root cause.

#### Why not Context

Context re-renders every subscriber when the context value changes. A `PrefsContext` holding the 15-field `UserPreferences` object would re-render `DigestPage` on every settings change — even fields `DigestPage` doesn't read. Splitting into many fine-grained contexts reduces this but doesn't eliminate it.

#### Why Zustand

`useAppStore(s => s.prefs.selectedRegions)` re-renders the component only when `selectedRegions` changes. Changing `theme` in settings does not touch `DigestPage`. The digestPrefs freeze becomes structurally unnecessary. The benefit scales as the tree deepens.

Four concrete reasons grounded in the legacy code:

1. **The digestPrefs freeze is a Zustand symptom.** The hack exists because the app can't afford re-rendering `DigestPager` on every settings change. Zustand selectors make it structurally impossible.
2. **Module-level Map caches in `useDigest`, `useGlobalHeadlines`, `useCurrencyRates` prove the app already needs external state.** They used module-scope Maps because React state alone couldn't survive remounts. Zustand formalizes this with subscriptions.
3. **Notification handlers need to navigate outside React.** The current `useAppNavigation` uses an `onDailyDigestRef` ref dance. With Zustand: `useAppStore.getState().setScreen('digest')` — no refs, no callbacks.
4. **`useNavState` is global persistent state, not local component state.** It manages a 30-min TTL, 700ms debounced MMKV writes, and an `AppState` listener. It belongs centralized.

#### What goes where

| State                                             | Owner                        | Reason                                                          |
| ------------------------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| `screen`, `dayIndex`, `article`                   | Zustand `nav` slice          | Persistent, globally read, needed by notification handlers      |
| `prefs` (UserPreferences)                         | Zustand `prefs` slice        | Read by many components; selectors eliminate cascade re-renders |
| `session`, `authReady`, `isPasswordRecovery`      | Zustand `auth` slice         | Globally read; written by auth hook                             |
| `appState` (boot state machine)                   | Zustand `app` slice          | Single source of truth for boot progress                        |
| Digest payloads, global headlines, currency rates | React Query                  | Async server data; loading/error/refetch for free               |
| Sign-in/sign-up/session-refresh logic             | `useSupabaseAuth` hook       | Complex async init; hook writes to auth slice                   |
| FCM registration logic                            | `useDeviceRegistration` hook | Complex async init; hook writes to device slice                 |
| MMKV preferences persistence                      | `usePreferences` hook        | Drives hydration + Supabase sync; writes to prefs slice         |

#### The "store writer" pattern

Existing hooks become **store writers**, not state owners. They keep their complex async initialization logic but call `useAppStore.setState(...)` instead of returning values to `App.tsx`. Components read directly from the store.

#### Slice-by-slice impact

| Slice             | Zustand work                                                                                                           | Net props removed                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| app/foundation    | `src/store/index.ts`; `app` slice (boot state machine); `nav` slice skeleton                                           | —                                          |
| app/auth-flow     | `auth` slice; `useSupabaseAuth` writes session to store                                                                | `session`, `authReady` off App.tsx         |
| app/digest-flow   | `DigestPager`/`DigestPage` read prefs via selectors; delete digestPrefs freeze; React Query replaces module-level Maps | `t`, `theme`, `aes` off DigestPage         |
| app/settings-flow | `prefs` slice; `usePreferences` writes to store; `setPref` calls `store.setState`                                      | `t`, `setPref`, `flush` off SettingsScreen |
| app/article       | `article` entry moves to nav slice                                                                                     | `article`, `setArticle` off App.tsx        |
| app/notifications | Handlers call `store.getState().navigateToDigest()`                                                                    | Removes ref-dance in `useAppNavigation`    |

---

### 8.2 Boot state machine

**Decided: explicit named states, not boolean flags.**

The legacy has 5 independent boolean flags (`fontsLoaded`, `authReady`, `hydrated`, `navReady`, `deviceReady`) all ANDed together. Problems: no distinction between boot stages, no error state, and no path to show a loading indicator or surface a failure.

The rebuild models boot as an explicit state machine in the Zustand `app` slice:

```
'booting'         ← initial; fonts loading, MMKV reading, nav state restoring
    ↓
'auth-check'      ← fonts done, checking Supabase session
    ↓
'unauthenticated' ← no session → render LoginScreen
'prefs-loading'   ← session exists, hydrating preferences + device registration
    ↓
'ready'           ← all systems go → render screen from nav slice
    ↓
'update-required' ← (future) backend signals a mandatory app update
'maintenance'     ← (future) backend signals downtime
```

`App.tsx` switches on `appState` — one clear place to add new boot-time gates. Each transition is a named store action. Debug logs identify exactly which stage the app is stuck in.

This is also the hook point for future backend-driven gates: a `GET /api/status` call during `auth-check` can push the machine into `update-required` or `maintenance` before any user data loads.

---

### 8.3 Navigation: manual routing

**Decided: manual conditional rendering, not React Navigation. Do not revisit for V1.**

App.tsx renders screens via `screen === 'digest' && <DigestPager />` driven by the Zustand `nav` slice.

Reasons:

- The settings overlay requires `DigestPager` and `SettingsScreen` to be simultaneously mounted — React Navigation's stack model works against this.
- DigestPager's RNGH pan gesture conflicts with a stack navigator's swipe-back gesture; `simultaneousHandlers` config is non-trivial.
- The app has 4 screens with no deep stacks. React Navigation earns its keep in tab/deep-stack apps; it adds complexity here without benefit.

React Navigation migration is recorded in `todo.md` V2 for post-parity evaluation.

---

### 8.4 Boot UI: native splash hold

**Decided: hold the native Expo splash until `appState === 'ready'`, not the legacy blank JS view.**

The legacy shows a plain `View` with `backgroundColor: theme.bg` while booting — a blank screen that flashes briefly on every cold launch before fonts and auth resolve.

The rebuild uses `expo-splash-screen`:

- `SplashScreen.preventAutoHideAsync()` is called at module level in `index.ts` (before any React renders).
- The native splash (`assets/splash-icon.png`) stays visible through the entire `booting → auth-check → prefs-loading` sequence.
- `SplashScreen.hideAsync()` is called once `appState` transitions to `'ready'` or `'unauthenticated'`.
- The JS-rendered `SplashScreen` component (Pulse mark animation) remains the _post-auth_ screen — same role as in the legacy, but no longer the boot loading gate.

This eliminates the flash-of-blank-screen on cold launch with ~5 lines of code. It is also the standard pattern for Expo apps in production. The `'update-required'` and `'maintenance'` states (§8.2) hide the splash and render their own full-screen UI before the user reaches any app content.

---

## 9. Per-slice discipline

- **One slice = one PR.** No combined slices.
- **Port behavior first, improve structure second.** Match legacy behavior exactly. Structural improvements (extracting helpers, renaming, splitting files) are allowed in the same PR. Algorithm or behavior changes are not. If you spot a better way, write it in `todo.md` and do it in a `fix/*` branch after parity.
  - Rule of thumb: if legacy and rebuild would produce different outputs on the same input, it is a behavior change and must be deferred.
- **Skill-driven quality improvements are allowed in the same PR.** The installed skills (`typescript-pro`, `react-expert`, `react-native-expert`, `test-master`, `security-reviewer`) are authoritative on code quality within each slice. They may: strengthen types, apply idiomatic patterns, improve test architecture, and harden security posture. The hard constraint remains: same inputs → same outputs. Any improvement that changes observable behavior must go to `todo.md`.
- **Tests go in the same PR.** Not "tests later." Test what hurts when it breaks — ranking, dedup, auth state, deep link parsing, digest assembly. Skip snapshot tests on pure presentation. Aim 60–70% coverage on the right lines. Invoke `test-master` on each test file before committing.
- **`/code-review` before opening the PR**, not after. Fix findings on the branch. Invoke `code-reviewer` skill for a deeper pass on logic-heavy slices.
- **`/security-review`** on slices that touch auth, notifications, API endpoints, or deep links. Invoke `security-reviewer` skill alongside it. Skip both on pure-logic slices.
- **PR description links the legacy file(s) it replaces.** Enables completeness audit.

---

## 10. Definition of "caught up"

- Every bullet in `BEHAVIOR.md` is implemented.
- Every fix in the `todo.md` parity list is incorporated.
- CI is green on `develop`.
- A local Expo build can be installed and used end-to-end without hitting a regression versus legacy.

Then: merge `develop` → `main`, tag `v1.0.0`, rename the GitHub repo to `pulse-news`, archive the old repo and the local `pulse-news-legacy/` directory, switch to normal `feat/*` and `fix/*` flow, and start working through the deferred improvements in `todo.md`.
