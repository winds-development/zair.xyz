# ZAIR Discord Bot

ZAIR is a Discord bot that connects automatically when the project starts and provides moderation, ticket, help, and utility commands.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server and Discord bot
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DISCORD_BOT_TOKEN` — the Discord bot token, stored securely in Replit Secrets

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Bot behavior: `artifacts/api-server/src/lib/raze-bot.ts`
- Runtime entrypoint: `artifacts/api-server/src/index.ts`
- Health endpoint: `artifacts/api-server/src/routes/health.ts`

## Architecture decisions

- The Discord token is read only from the secure `DISCORD_BOT_TOKEN` secret and is never stored in source code.
- The API health server and Discord gateway run in the same process so the project stays active while ZAIR is connected.

## Product

- Automatic Discord gateway connection and online presence
- `/help` and `!help` command responses with category navigation
- Moderation, auto-moderation, ticketing, security, and utility commands
- `/api/healthz` health endpoint for runtime checks

## User preferences

The user provided an existing ZAIR bot archive and asked for it to run automatically when the project is opened.

## Gotchas

- Keep `DISCORD_BOT_TOKEN` configured in Replit Secrets before starting the API workflow.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
