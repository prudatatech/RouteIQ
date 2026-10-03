# MargixIndia: rules and workflow for every session and agent

Read this first, then `docs/HANDOFF.md` (current state and open items) and `docs/platform-model.md` (what the
product is). These rules come from the owner and override defaults.

## Hard rules
- NEVER send any message (email, SMS, WhatsApp, chat, calendar invite) to it@sumeruglobal.in. It is the owner's
  official mailbox. Do not use it as a test recipient, fixture, seed, script default or `to:` value. Never send to
  any other real address unless the owner names the recipient in chat. To check email, use the Resend dashboard or
  API (domain status, message list) or a throw-away recipient the owner names.
- Never print, paste or commit secrets. `infra/secrets.*.env`, `infra/platform.*.env`, `infra/azure.local.env` are
  gitignored. Read values from those files inside commands; never echo them.
- Commits end with `Co-Authored-By: Deepstacker <dev.deepstacker@gmail.com>`. Never add Claude as co-author, and
  no "Generated with Claude Code" footer in PR descriptions.
- Only two branches exist: `main` (live) and `test`. Work lands on `test`; release by PR `test` -> `main`; after a
  release `test` is fast-forwarded to `main`. Never push to `main` directly. Delete any temporary branch/worktree
  after merging it.
- No IAM/permission changes, no creating accounts, no entering credentials on hosted sites, no setting secrets the
  owner has not given. Things that need the owner's accounts go in the "Owner actions" list of `docs/HANDOFF.md`.
- Live data is real: test against the `test` stage (staging.*). Read-only checks on live are fine; never write to
  live data except through a normal release.

## The Mac is weak (it freezes)
- No local Docker stacks, dev servers, headless browsers, `docker build`, `npm run build` or full test suites.
- Allowed locally: `git`, `gh`, `az`, `curl`, light `node` scripts, and nice'd targeted checks:
  `nice -n 15 npx tsc --noEmit`, eslint on changed files, `vitest run <files or one folder>`.
- Heavy work runs on GitHub (CI `ci.yml`, story `uat.yml`) or Azure.
- Sub-agents: at most 3 heavy and 5 total at once; check `uptime` before launching; pass `model: "sonnet"` for
  well-scoped work (opus only for architecture, tricky merges, final review); each agent works in its own git
  worktree on a temporary branch from `origin/test`, commits but does not push; the lead merges, checks, pushes.
  Agents stop anything they started and never kill processes they did not start.

## Before pushing to `test`, run what CI runs (light versions)
- backend-ts: `npx tsc --noEmit -p .`, `npm run check:queries`, targeted `vitest run test/<files>`.
- frontend: `npx tsc --noEmit`, `npx eslint src --max-warnings=0` (CI fails on ANY warning, e.g.
  react-refresh/only-export-components: keep hooks/helpers out of component files), `npm run check:vocabulary`
  (retired words in screen text, e.g. "route" -> trip; see docs/vocabulary.md), targeted `vitest run`.
- Then watch BOTH workflows for the pushed commit: `margixindia CI` and `Deploy to Azure`
  (`gh run list --branch test`). A green deploy does not mean CI passed.
- Behaviour changes: run the 91-step story on GitHub: `gh workflow run uat.yml --ref test` (must stay 91/91), and
  the relevant staging walk in `e2e/staging/*.mjs` (node, against staging only; helpers in `actors.mjs`).

## Development guidelines
- Understand the architecture and existing code before changing it; follow existing conventions.
- No hardcoded values, mock data or placeholders in app code. Things that look fake are roadmap: implement them for
  real, never delete them unless the owner says so.
- Every operational record belongs to an organisation and is scoped (RLS + org-scope helpers). Keep vendor,
  logistic company, 3PL and platform-admin areas and permissions separate.
- Keep it simple; consistent UI kit (`frontend/src/components/ui`); plain words (docs/vocabulary.md).
- Validate before calling anything done; report failures honestly with the output.
- Anything that passes on the GitHub runner can still break on Azure (see "Azure pitfalls" in docs/HANDOFF.md):
  after infra, migration or storage changes, prove it on staging with a real call.

## Database migrations
- Files in `supabase/migrations/<timestamp>_<name>.sql`, idempotent, app_owner pattern (copy a recent one, e.g.
  `20261010120000_load_priority_price_range.sql`). Add new tables/columns to `backend-ts/test/support/db-schema.json`.
- Applied by the `migrate` job of `Deploy to Azure` (`scripts/db-migrate.sh`): it dry-runs all pending files in one
  transaction first, then applies and records them in `public.app_migrations`.
