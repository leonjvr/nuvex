## Why

NUVEX has 120 GitHub comments requesting multi-language support — the single most-commented feature request on any comparable platform. Agents today always respond in English regardless of the user's language. Operators running regional deployments (Middle East, Latin America, Southeast Asia) cannot serve their users effectively. Adding locale-aware string rendering to the brain and gateways unlocks the entire non-English market without any code changes per language.

## What Changes

- Add a `locale` field to each agent definition in `divisions.yaml`
- Brain resolves the correct locale for each conversation thread from: (1) user preference stored in thread metadata, (2) agent default locale in `divisions.yaml`, (3) fallback `en`
- System prompt fragments (SOUL.md, governance rejection messages, tool error strings) are rendered through a locale layer that substitutes translated strings
- A `locales/` directory in the brain holds JSON translation files keyed by BCP-47 locale code (e.g. `es.json`, `ar.json`)
- Gateway-layer status messages (typing indicators, error fallbacks) also respect the resolved locale
- A `GET /api/locales` endpoint lists available locales and their completeness percentage
- **BREAKING**: `divisions.yaml` gains a new optional `locale:` key per agent. Existing configs without the key default to `en` and are fully backwards compatible.

## Capabilities

### New Capabilities

- `locale-resolver`: Determines the active locale for a conversation thread
- `brain-i18n`: Translation file loading, string interpolation, and locale-aware rendering in brain
- `gateway-i18n`: Locale-aware status and error messages in gateway containers

### Modified Capabilities

- (none — no existing spec-level requirements change; locale key in divisions.yaml is additive and optional)

## Impact

- **`divisions.yaml`**: new optional `locale:` key per agent definition
- **DB**: new `locale` column on `threads` table (nullable TEXT, BCP-47 code)
- **Brain**: new `src/brain/i18n/` module with locale resolver and string renderer
- **Locales directory**: `locales/*.json` files (English already partially exists from gateway work)
- **All gateways**: must pass resolved locale to brain; must render locale-aware fallback messages
- **No breaking changes** for deployments that omit `locale:` — defaults gracefully to `en`
