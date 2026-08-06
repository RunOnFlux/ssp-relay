# SSP Relay

Coordination relay server at `relay.sspwallet.com`. Bridges communication between SSP Wallet (browser) and SSP Key (mobile). Public, open source — **must stay minimal**.

## Part of SSP Ecosystem

See `../CLAUDE.md` for full ecosystem overview.
- **Do not work in** `ssp-walletOK` or `ssp-walletNodes` — those are deprecated archives

## CRITICAL: Submodule Architecture

This repo contains two **private submodules**:

| Submodule | Path | Purpose |
|---|---|---|
| **ssp-relay-enterprise** | `ssp-relay-enterprise/` | ALL enterprise business logic, auth, analytics, services |
| **ssp-relay-dashboard** | `ssp-relay-dashboard/` | Next.js admin dashboard, direct MongoDB access |

### Public vs Private Rule

**This repo (ssp-relay) is PUBLIC.** It must contain ONLY:
- Minimal routing / pass-through code
- Interface definitions
- No-op fallback implementations
- Generic utilities

**ALL business logic goes in ssp-relay-enterprise.** Never add analytics, enterprise validation, or proprietary algorithms to the public relay code.

```typescript
// CORRECT pattern in ssp-relay — pass-through only:
async function postLoginWK(req: Request, res: Response): Promise<void> {
  const result = await enterpriseHooks.enterpriseLogin(req);
  res.json(serviceHelper.createDataMessage(result));
}
```

## Stack

- Node.js 24+, Express 5.x, TypeScript 5.9
- MongoDB 7.x
- Socket.io 4.8 (real-time wallet ↔ key communication)
- Viem, Alchemy SDK, AA Schnorr MultiSig SDK

## Commands

```bash
yarn start        # Compile + run server (port 9876)
yarn dev          # Development mode
yarn test         # Mocha + Chai with nyc coverage
yarn lint         # ESLint
yarn lint:fix     # ESLint auto-fix
yarn type-check   # tsc --noEmit
yarn backup       # Database backup
yarn prettier --check .   # Format check
yarn prettier --write .   # Format fix
```

## Before Every Commit

All must pass — no exceptions:
1. `yarn type-check` — no type errors
2. `yarn lint` — no lint errors
3. `yarn prettier --check .` — properly formatted
4. `yarn test` — tests pass

## Key Rules

- **Always yarn**, never npm
- **Dependencies strictly locked** — exact versions only, no `^` or `~` in package.json
- **PUBLIC repo** — no business logic here
- TypeScript strict mode, no `any` without justification
- API responses: `{ status: 'success'|'error', data: {...} }`
- Never log sensitive data (signatures, keys)
- Rate limiting on all endpoints

## Source Structure

```
src/
├── apiServices/    # API route handlers (pass-through to enterprise)
├── services/       # Core relay services (socket coordination)
├── middleware/      # Express middleware
├── lib/            # Utilities
├── routes.ts       # Route registration
└── types/          # TypeScript definitions
ssp-relay-enterprise/   # Private submodule — all enterprise logic
ssp-relay-dashboard/    # Private submodule — admin dashboard
```

## ssp-relay-enterprise (Private Submodule)

Contains ALL enterprise logic:
- Authentication service (WK identity verification)
- Session management
- Organization management
- Invitation system
- Critical action handling
- Portfolio tracking, balance fetching, address derivation
- Notification service, background jobs
- MongoDB collections with `enterprise_` prefix

## ssp-relay-dashboard (Private Submodule)

Next.js admin dashboard. Queries MongoDB **directly** — does NOT call ssp-relay APIs.
Collections accessed: `enterprise_login_attempts`, `enterprise_sessions`, `enterprise_users`, `enterprise_organizations`, `enterprise_memberships`, `enterprise_invitations`, `enterprise_org_audit_logs`, `enterprise_critical_action_logs`, plus core `v1users`, `v1activity`, `v1transactions`.
