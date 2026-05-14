# AGENT Notes

## Purpose

This project is a playable **web MVP of Decrypto / 解码战**.

Goals:

- 4 players total
- 2 teams: `A` and `B`
- each team has exactly:
  - `encoder`
  - `decoder`
- different players must see different information
- no custom backend server
- `Supabase` is used as auth + database + realtime + permission layer

This is a working prototype, not a finished product.

## Stack

- `React 19`
- `TypeScript`
- `Vite`
- `@supabase/supabase-js`
- Supabase:
  - Anonymous Auth
  - Postgres
  - Realtime
  - RPC functions
  - RLS

## High-Level Architecture

- Frontend renders room/game UI and calls Supabase RPCs.
- Supabase stores all room/game state.
- Realtime subscriptions refresh room state for all connected players.
- Hidden information is enforced mainly by **table split + RLS**, not by frontend-only hiding.

## Core Files

- [src/App.tsx](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/src/App.tsx)
  - main UI
  - room creation/join flow
  - seat selection
  - phase-based rendering
- [src/lib/game.ts](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/src/lib/game.ts)
  - all Supabase RPC calls
  - room snapshot fetch
  - realtime subscription
- [src/lib/supabase.ts](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/src/lib/supabase.ts)
  - client init
  - anonymous sign-in bootstrap
- [src/types.ts](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/src/types.ts)
  - frontend domain types
- [src/lib/utils.ts](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/src/lib/utils.ts)
  - helper logic: teams, roles, labels, guess normalization
- [src/styles.css](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/src/styles.css)
  - entire UI styling
- [supabase/schema.sql](C:/Users/Hu_care/Desktop/zrh/其他/Anime-Decrypto/supabase/schema.sql)
  - schema
  - RLS policies
  - RPC functions
  - realtime publication setup

## Data Model

Important tables:

- `rooms`
- `room_players`
- `team_words`
- `round_codes`
- `round_submissions`

Important RPCs:

- `create_room`
- `join_room`
- `update_self_seat`
- `start_game`
- `submit_clues`
- `submit_intercept_guess`
- `submit_own_guess`
- `advance_round`

## Current Gameplay Scope

Implemented phases:

- `lobby`
- `clue`
- `intercept`
- `decode`
- `result`
- `finished`

Implemented behavior:

- create/join room
- custom 6-char room code supported on room creation
- fixed 4 seats
- host starts the game
- each team receives 4 hidden words
- current encoder sees current code
- encoders submit clues
- decoders guess opponent code and own code
- score tracks interceptions and miscommunications

## Current Product Boundaries

Not complete / still prototype-level:

- no spectator mode
- no chat
- no polished reconnect flow
- no room cleanup lifecycle
- no ranking/history system
- no full production hardening
- rules are simplified to the current MVP flow

## Important Implementation Notes

- The app expects:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Supabase anonymous auth must be enabled.
- Realtime must include the project tables from `schema.sql`.
- Frontend should use RPCs for game mutations; do not bypass them with ad hoc direct table writes unless intentionally redesigning the model.
- Hidden data rules live in Supabase. Do not rely on UI-only hiding for security-sensitive changes.

## Known History / Gotchas

- `create_room` and `join_room` previously had PL/pgSQL naming conflicts around `room_id` / `room_code`.
- Current SQL avoids this by using renamed return columns and explicit naming.
- If these functions are changed again, be careful with `RETURNS TABLE(...)` names in PL/pgSQL.

## What To Read First

For most tasks, read only:

1. `src/App.tsx`
2. `src/lib/game.ts`
3. `supabase/schema.sql`

Read `src/styles.css` only for UI/styling tasks.
Read `docs/project-summary.md` for a fuller human summary.

## What To Ignore Usually

Usually not worth reading first:

- `dist/`
- `node_modules/`
- generated build artifacts like:
  - `vite.config.js`
  - `vite.config.d.ts`
  - `*.tsbuildinfo`
