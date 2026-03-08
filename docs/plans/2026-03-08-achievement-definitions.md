# 2026-03-08 Achievement Definitions (backend configurable)

## Goal
Move `/account/achievements` display config out of hardcoded Edge Function logic into Supabase, while keeping the existing response contract stable for the Account page.

## What moved to config
Table: `public.achievement_definitions`

Per achievement row:
- `key`
- `title`
- `badge`
- `enabled`
- `sort_order`
- `base_multiplier`
- `locked_tag_label`
- `unlocked_tag_label_template`
- `locked_description`
- `unlocked_description_template`
- `level_config` (`jsonb`, e.g. GM-NFT level name map)
- `metadata`

## Runtime vs config split
Runtime-only state is still computed at request time:
- whether the user unlocked the achievement
- current GM-NFT level / name
- latest vote bonus eligibility row

Config-only state comes from the table:
- tag text
- display title
- description templates
- default multiplier
- display order
- level-name mapping

## Current supported keys
- `vebetter_vote_bonus`
- `gm_nft`

New keys are not automatically supported unless runtime logic is added in `supabase/functions/api/index.ts`.

## API notes
`/account/achievements` now also returns optional `tag_label` for frontend chip rendering.
Legacy fallback logic remains in the web app if `tag_label` is absent.

## Operational note
No visual admin UI is planned. Configuration changes are expected to be applied directly in Supabase (table row edits / SQL), coordinated in chat.
