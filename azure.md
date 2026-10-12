# RouteIQ - Azure & Environment Context

This file serves as a memory state for continuing development seamlessly in a new chat session.

## Azure CLI Status
- **Status:** Logged in.
- **Account:** `kushagratiwari252@gmail.com`
- **Resource Group:** `margix-rg`

## Core Project Rules (from CLAUDE.md & docs/HANDOFF.md)
- **NO local Docker stacks** or deployment via local servers.
- The environment relies on Supabase, Redis, and external APIs directly (configured in `backend-ts/.env`).
- **Git Workflow:** Only two branches exist: `main` (live) and `test` (staging).
- Deployments happen automatically via CI/CD when pushing to the `test` or `main` branches.

## Recent Fixes & Progress
1. **Backend Vehicle Approval Bug:**
   - Fixed an issue in `backend-ts/src/services/vehicle-approval.service.ts` where the driver app (specifically testing with `9431900030`) was stuck on the "Waiting for approval" screen.
   - The backend was mistakenly prioritizing pending self-submitted registrations over admin-approved vehicles. It now correctly checks for an active/approved vehicle first.
2. **Expo SDK 57 Compatibility (Driver App):**
   - Upgraded `driver-app` to use Expo SDK 57.
   - Addressed crashes on Expo Go caused by the removal of native remote push notifications (`expo-notifications`). The library was patched locally (`patch_expo_notifications.js` / node_modules modifications) to fail gracefully so local development in Expo Go can continue without fatal errors.

## Current Pending Blockers
- **Git Pull Conflict:** A recent attempt to run `git pull origin test` failed because there are uncommitted local changes in `driver-app/src/components/home/RouteMap.tsx`.
- **Next Step:** You must either `git stash` or `git commit` the changes in `RouteMap.tsx` before you can successfully pull the latest code and proceed.

## Next Agent Instructions
When starting a new session:
1. Read this file, `CLAUDE.md`, and `docs/HANDOFF.md` completely.
2. Ensure you have CLI tools ready (git, az, npm, etc.).
3. Help the user resolve the `RouteMap.tsx` git conflict and push the recent backend and driver-app fixes to the `test` branch for deployment.
