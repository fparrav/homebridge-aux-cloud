# Phase 1 Plan 1: beta.9 — Persistent LAN Session Summary

## One-liner

Replace per-call ephemeral UDP sockets with a persistent LAN session per device (keyed by MAC) to eliminate Broadlink auth timeout issues caused by repeated ephemeral-port authentications.

## Key Decisions

1. **Persistent socket per device** — One UDP socket per MAC, auth once, reuse session key for all packets
2. **Resolver queue for state responses** — `stateResolvers` array with `shift()` to handle concurrent polls
3. **5s timeout** for both auth and state response (up from 3s)
4. **`authenticated` flag** — Marked false on socket error to force re-auth on next use
5. **Helper methods kept** — `createLanSocket`, `bindSocket`, `sendPacket` retained for internal use in `getOrCreateSession`

## Deviations from Plan

None - plan executed exactly as written. All tasks completed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Refactor to persistent LAN session | a2f3378 | `src/api/AuxDeviceControl.ts` |
| 2 | Bump version to beta.9 | 0f68d41 | `package.json`, `CHANGELOG.md` |

## Files Modified

| File | Change |
|------|--------|
| `src/api/AuxDeviceControl.ts` | Refactor to persistent LAN session (new `LanSession` interface, `lanSessions` Map, `getOrCreateSession`, `doSessionAuth`) |
| `package.json` | Version bump 0.0.7-beta.8 → 0.0.7-beta.9 |
| `CHANGELOG.md` | Add beta.9 entry |

## Self-Check: PASSED

- TypeScript compilation: clean (no errors)
- Build: `npm run build` succeeds
- Commits: both present in git log
- No auth gates encountered
