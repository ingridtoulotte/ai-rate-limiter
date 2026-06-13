# Contributing

Thanks for helping make LLM spend predictable.

## Develop

```bash
npm install
npm run typecheck     # tsc --noEmit
npm run build         # emit dist/
npm test              # node --test via tsx
```

## Guidelines

- **Zero runtime dependencies.** New backends/providers must not add a required
  dependency — use optional peers and dynamic import (see `RedisStore`).
- **Add a test** for any behavior change (`test/*.test.ts`).
- **Keep cost honest.** Unknown models stay flagged at `$0`; never silently guess a price.
- **New provider?** Implement `ProviderAdapter` (`matches`, `estimateInputTokens`,
  `extractUsage`) and register it in `src/providers/index.ts`.

## Adding a model price

Edit `DEFAULT_PRICING` in `src/pricing.ts` (USD per 1,000,000 tokens). Prices drift —
prefer documenting the source date in the PR.
