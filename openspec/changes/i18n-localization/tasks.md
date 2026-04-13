## 1. Database & Schema

- [ ] 1.1 Write Alembic migration to add nullable `locale TEXT` column to `threads` table
- [ ] 1.2 Add `locale: Optional[str]` field to the `Thread` SQLAlchemy model

## 2. Locale Resolver

- [ ] 2.1 Create `src/brain/i18n/` package with `__init__.py`
- [ ] 2.2 Implement `LocaleResolver.resolve(thread_id, agent_id) -> str` method: DB locale → agent divisions.yaml locale → `"en"`
- [ ] 2.3 Parse `locale:` key from agent entries in `divisions.yaml` during config load (`src/shared/config.py`)
- [ ] 2.4 Add `PUT /api/threads/{thread_id}/locale` endpoint with BCP-47 validation (regex `^[a-z]{2,3}(-[A-Z]{2,4})?$`)
- [ ] 2.5 Unit tests for `LocaleResolver`: user pref > agent default > en fallback, all three paths

## 3. Brain i18n Translation Layer

- [ ] 3.1 Create `src/brain/i18n/locales/en.json` with all brain-internal string keys (governance rejections, tool errors, etc.)
- [ ] 3.2 Implement `TranslationStore.load_all(locales_dir)`: scan `*.json`, log and skip malformed files
- [ ] 3.3 Implement `t(key, locale, **kwargs) -> str`: locale lookup → English fallback → key-as-string fallback; `{variable}` interpolation
- [ ] 3.4 Create `GET /api/locales` endpoint: return code, English language name, completeness percentage
- [ ] 3.5 Register locales router in `src/brain/server.py`
- [ ] 3.6 Unit tests for `TranslationStore`: load, malformed skip, `t()` with all three fallback paths, interpolation

## 4. Language Instruction Injection

- [ ] 4.1 Add BCP-47-to-English-name mapping dict in `src/brain/i18n/languages.py` covering the 25+ locales in `locales/`
- [ ] 4.2 In the system prompt assembly step, prepend `"You MUST respond in <language>."` when resolved locale is not `"en"`
- [ ] 4.3 Unit tests: instruction added for `de`, `fr`, `ar`; not added for `en`

## 5. Gateway i18n

- [ ] 5.1 Telegram gateway: read `user.language_code` from Telegram Update and pass `locale` field when creating thread via brain API
- [ ] 5.2 WhatsApp gateway: omit locale field when no language metadata available in incoming message
- [ ] 5.3 Each gateway: before sending status/error messages, call `GET /api/threads/{id}` to get resolved locale and look up string from gateway `locales/*.json`
- [ ] 5.4 Unit/integration tests for Telegram locale passthrough; gateway error message in correct locale

## 6. Startup Wiring

- [ ] 6.1 Call `TranslationStore.load_all()` during brain startup before first request is accepted
- [ ] 6.2 Make `LocaleResolver` and `t()` available as shared singletons (module-level or FastAPI dependency)
