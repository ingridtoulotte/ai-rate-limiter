# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [0.1.0] - 2026-06-14

Initial release.

### Added
- **Policy engine** — request / token / cost limits over minute, hour, day, month, or
  any millisecond window; scopes `global | user | org | project | model | route`;
  per-rule `match` filters and soft `warnAt` thresholds.
- **Two-phase enforcement** — atomic reserve-then-reconcile: estimate cost up front to
  block before spending, then adjust counters to the real usage from the response.
- **Cost tracking** — pricing table for OpenAI, Anthropic, Gemini, and Mistral
  (USD/1M tokens, overridable); cached-input discounts honored; unknown models tracked
  at `$0` and flagged.
- **Provider adapters** — OpenAI, Anthropic, Gemini, Mistral (request token estimation +
  response usage parsing); `ProviderAdapter` interface for custom providers.
- **Stores** — zero-dependency `MemoryStore` and atomic `RedisStore` (optional `ioredis`).
- **API** — `RateLimiter` with `check`, `record`, `guard`, `wrap`, and `estimate`;
  `enforce`/`monitor` modes and `open`/`closed` fail modes.
- **Alerts** — `consoleAlert`, `webhookAlert`, and `callbackAlert` hooks for warnings,
  limit breaches, and recorded usage.
- **Config** — JSON / YAML / JS loader with environment-variable overrides;
  `createLimiter` helper.
- **Budget board** — `renderReport` plus the `arl` CLI (`simulate`, `report`, `check`,
  `pricing`).
- 29 unit tests; CI on Node 18 / 20 / 22.
