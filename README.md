# Spaza OS

Offline-first Expo + React Native operating system for spaza shops. It keeps sales,
stock, credit tabs and cash-ups in local SQLite, and includes a local quick-note
co-pilot for stock and credit updates without a network connection.

## Getting Started

Install dependencies:

```bash
bun install
```

Then run the development server:

```bash
bun run dev
```

Use the Expo Go app or a development build to run the mobile application.

## Environment Configuration

The environment schema lives in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing the schema. Commit the schema, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code.

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration loads Varlock. Run standalone Node/Bun tools that use Varlock from the repo root so they load this schema and env files.

## Available Scripts

- `bun run dev`: Start the Expo development server
- `bun run android` / `bun run ios`: Run on device/emulator
- `bun run web`: Start the web build
- `bun run check-types`: Check TypeScript types
- `bun run env:generate`: Regenerate `src/env.ts` from `.env.schema`
