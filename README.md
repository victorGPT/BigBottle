# BigBottle (MVP)

Mobile-first receipt scanning app for bottle recycling incentives.

## MVP Scope (Phase 1)

- VeWorld wallet login (challenge-response signature)
- Capture/upload receipt photo (AWS S3 presigned upload)
- Verify via Dify and calculate points
- Persist submissions in Supabase
- Mobile UI based on the Pencil design file in `designs/`

## Repo Layout

- `apps/web`: Vite + React (mobile web dApp)
- `apps/api`: Fastify API server
- `docs/plans`: Single source of truth for product/engineering brief
- `designs`: Pencil `.pen` design source

## Quick Start

1. Install deps: `pnpm i`
2. Configure env:
   - `apps/api/.env` (see `apps/api/.env.example`)
   - `apps/web/.env` (see `apps/web/.env.example`)
3. Apply DB schema in Supabase:
   - Run `supabase/migrations/20260206_init.sql` in the Supabase SQL editor
4. Run dev: `pnpm dev`

## Notes

Phase 2 (out of MVP): on-chain B3TR distribution, claim flow, fee delegation (sponsor gas).
