import { defineConfig } from 'tsup'

// Peer dependencies (hono, @tanstack/query-core, neverthrow, better-result) are external automatically.
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/neverthrow.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    sourcemap: true,
  },
  {
    // better-result is ESM-only, so this entry point is too.
    entry: ['src/better-result.ts'],
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
  },
])
