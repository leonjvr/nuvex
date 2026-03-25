# SIDJUA GUI Smoke Test Checklist

Manual test checklist for verifying the SIDJUA web interface after deployment.
Run these checks against a fresh install (`sidjua init`) before releasing.

---

## Prerequisites

- `sidjua init` completed (server running on port 3000)
- Browser open at `http://localhost:3000`
- No LLM provider configured yet (fresh state)

---

## Scenario 1: Fresh Install State

- [ ] Dashboard loads without errors
- [ ] Left sidebar shows: Dashboard, Chat, Agents, Divisions, Governance, Audit Log, Cost Tracking, Configuration, Settings
- [ ] Agents badge in sidebar shows "6"
- [ ] Navigate to `/agents` — 6 agent cards visible
- [ ] Each card shows agent name, tier badge (T1/T2/T3), and status indicator
- [ ] Navigate to `/divisions` — System Division visible
- [ ] Navigate to `/settings` — no API key configured message shown
- [ ] GET `/api/v1/provider/config` returns `{ configured: false }`
- [ ] GET `/api/v1/chat/guide/history` returns `{ messages: [], conversation_id: null }`

---

## Scenario 2: Provider Setup Flow (Groq Free Tier)

- [ ] Go to Settings → LLM Provider section visible
- [ ] Provider dropdown lists at least 4 options including Groq (free)
- [ ] Select "Groq – Llama 3.3 70B (Free)" from dropdown
- [ ] "Sign up at console.groq.com" link visible
- [ ] Paste a valid Groq API key (starts with `gsk_`)
- [ ] Click "Test Connection" — spinner appears
- [ ] Green "Connection successful" message appears (or error if key is invalid)
- [ ] Click "Save" — success toast appears
- [ ] Page refreshes provider status to show "Configured: Groq – Llama 3.3 70B"
- [ ] GET `/api/v1/provider/config` returns `{ configured: true, mode: "simple", ... }`
- [ ] API key is masked in the response (e.g., `gsk_***...***`)

---

## Scenario 3: Agent Chat Flow

- [ ] Navigate to `/chat` — redirects to `/chat/guide`
- [ ] Guide agent selected in agent switcher (top bar)
- [ ] Input field enabled and focused
- [ ] Type "Hello, what can you do?" and press Enter
- [ ] User message bubble appears immediately
- [ ] Typing indicator (dots animation) appears
- [ ] Assistant reply streams in token-by-token
- [ ] Streaming completes — typing indicator disappears
- [ ] Full reply is visible in the chat
- [ ] GET `/api/v1/chat/guide/history` returns the user message and assistant reply
- [ ] Conversation ID is set in history response

---

## Scenario 4: Agent Switching

- [ ] In Chat view, click "HR Manager" in the agent switcher
- [ ] URL changes to `/chat/hr`
- [ ] Chat window is empty (separate conversation)
- [ ] Type a question for HR Manager and send
- [ ] HR replies independently of Guide conversation
- [ ] Click back to Guide — Guide conversation history is preserved
- [ ] Each agent shows their own conversation independently

---

## Scenario 5: Provider Error Handling

- [ ] Go to Settings → change API key to `gsk_invalid_key_test`
- [ ] Save the new key
- [ ] Navigate to Chat → Guide
- [ ] Type "Hello" and send
- [ ] Error message appears in chat: "Invalid API key"
- [ ] Chat input remains enabled (recoverable error)
- [ ] Fix the key in Settings → chat works again

**Rate limit simulation:**
- [ ] If using free tier (Groq), exceed 1,000 daily requests
- [ ] Error message shows "Rate limit reached. Please wait a moment and try again."

**Empty message handling:**
- [ ] Click Send without typing anything
- [ ] No message is sent (input validation)
- [ ] API returns 400 if called with empty message body

---

## Scenario 6: Clear Conversation

- [ ] Have a multi-message conversation with Guide
- [ ] Click the trash/clear icon in the chat header
- [ ] Confirmation dialog or immediate clear (verify behavior)
- [ ] Chat window clears — shows empty state
- [ ] GET `/api/v1/chat/guide/history` returns `{ messages: [], conversation_id: null }`
- [ ] Can start a fresh conversation after clearing

---

## Scenario 7: System Prompt Completeness

_Verify via API — no browser interaction required._

- [ ] `buildSystemPrompt(guide)` includes "SIDJUA" and "Handbook"
- [ ] `buildSystemPrompt(guide)` includes all 6 agent names
- [ ] `buildSystemPrompt(hr)` includes HR Manager name and description
- [ ] All 6 agents produce non-empty system prompts without errors

---

## Scenario 8: Responsive Layout + Theme

**Desktop (>1280px):**
- [ ] Sidebar fully expanded with labels visible
- [ ] Main content area has proper padding and layout
- [ ] Agent cards in 2-3 column grid

**Tablet (768–1024px):**
- [ ] Sidebar collapses to icon-only mode
- [ ] Icons still clickable with tooltips showing labels
- [ ] Main content fills remaining width

**Mobile (<768px):**
- [ ] Sidebar hidden by default
- [ ] Hamburger menu icon visible in header
- [ ] Tapping hamburger opens sidebar as drawer overlay
- [ ] Tapping a nav link closes the drawer

**Theme:**
- [ ] Light mode active by default
- [ ] Dark mode toggle in Settings → theme switches to dark
- [ ] All text readable in both themes
- [ ] Sidebar background uses `var(--color-sidebar-bg)` (dark indigo)
- [ ] Brand color #2563eb visible on active nav items

**PWA:**
- [ ] Browser shows install prompt (or "Add to Home Screen" on mobile)
- [ ] `/manifest.json` returns 200 with correct PWA metadata
- [ ] `/sw.js` returns 200 with service worker code
- [ ] `/offline.html` returns 200 with SIDJUA offline page

---

## Scenario 9: Full Journey (End-to-End)

Run as a single sequential flow:

1. [ ] Open browser to `http://localhost:3000` (fresh install)
2. [ ] Observe 6 agent cards on Agents page — all show "No provider configured"
3. [ ] Navigate to Settings → configure Groq free tier → save
4. [ ] Return to Agents page — cards now show "Chat" button enabled
5. [ ] Click "Chat" on the Guide card → redirects to `/chat/guide`
6. [ ] Send "What agents are on my team?" to Guide
7. [ ] Verify Guide mentions HR Manager, IT Administrator, Auditor, Financial Controller, Librarian
8. [ ] Click HR Manager in agent switcher → `/chat/hr`
9. [ ] Send "What can you help me with?" to HR Manager
10. [ ] HR Manager replies with HR-specific capabilities
11. [ ] Navigate back to Guide → previous conversation still visible
12. [ ] Clear Guide conversation
13. [ ] Verify Guide history is empty
14. [ ] Navigate to Divisions → System Division visible with budget info
15. [ ] Log out or close browser — no crashes

---

## Automated Test Coverage

The following automated tests in `tests/smoke/` cover the scenarios above:

| Scenario | Test File | Tests |
|----------|-----------|-------|
| 1. Fresh Install | `gui-smoke.test.ts` | 5 |
| 2. Provider Setup | `gui-smoke.test.ts` | 4 |
| 3. Chat Flow | `gui-smoke.test.ts` | 4 |
| 4. Agent Switching | `gui-smoke.test.ts` | 3 |
| 5. Error Handling | `gui-smoke.test.ts` | 4 |
| 6. Clear Conversation | `gui-smoke.test.ts` | 3 |
| 7. System Prompts | `gui-smoke.test.ts` | 6 |
| 8. Responsive + Theme | `gui-smoke.test.ts` | 8 |
| 9. Full Journey | `gui-smoke.test.ts` | 3 |
| Docs Completeness | `docs-completeness.test.ts` | 52 |

**Run automated tests:**
```bash
npx vitest run tests/smoke/
```

---

## Docker Architecture Checks

Run these after loading the Docker image:

- [ ] `docker inspect --format '{{.Architecture}}' sidjua/sidjua:1.0.0` shows correct arch (`amd64` or `arm64`)
- [ ] No "WARNING: The requested image's platform does not match the detected host platform" emulation warning on start
- [ ] `docker logs sidjua | grep '\[INFO\] Platform'` shows matching architecture
- [ ] `docker inspect --format '{{.Config.User}}' sidjua` shows `sidjua` (non-root user)

---

## Known Limitations (v1)

- Chat history is **in-memory only** — resets on server restart
- Advanced mode (per-agent providers) is configurable but not yet surfaced in the GUI (Settings shows simple mode only)
- PWA offline mode caches the shell but not conversation history
- Responsive drawer tested only on Chrome/Firefox; Safari Mobile may have minor layout differences

---

_Last updated: P181 (v1.0 release candidate)_
