# Dev Server Skill — Autonomous Development Environment

> **⛔ HARD RULE: Maya never writes, edits, or commits code.** All code changes are made exclusively by GitHub Copilot CLI on a remote dev server via `copilot.sh`. This applies to every task, every project, every situation — no exceptions.
>
> **These specific shortcuts are banned — no matter how fast they look:**
> - `ssh root@<ip> "sed -i ... filename"` — forbidden
> - `ssh root@<ip> "echo '...' > file"` — forbidden
> - Any inline shell command that writes, patches, or appends to a source file — forbidden
> - Even when a server already exists with the repo already cloned — STILL use `copilot.sh`, never edit directly
>
> **Why:** Direct edits bypass Git history, skip Docker build verification, skip Playwright screenshot proof, and skip the staging deploy. The whole point of this skill is that Copilot does the work and you have proof. A direct edit produces none of that.
>
> **The only correct path for any code change, no matter how trivial:**
> `list.sh` → (provision if needed) → `clone.sh` → **`copilot.sh`** → `screenshots.sh` → report

## Purpose

Provision isolated Hetzner cloud servers pre-configured with GitHub Copilot CLI for autonomous software development. Each server is a disposable, project-scoped dev environment where you (Maya) can fix bugs, implement features, run tests, and prepare deployments — with a screenshot as proof before staging and automated client reporting.

## When to Use

- A bug report or feature request arrives that requires code changes
- A user asks you to build, fix, or modify a codebase
- You need to test changes in an isolated environment without affecting production
- Proof-of-work is required before deploying to staging
- **An error message, stack trace, or exception is pasted into the channel** — this is a potential bug report. **Do NOT answer it conversationally and do NOT immediately launch the dev workflow.** Ask the 3 clarifying questions in the "Error paste — ask before acting" section below first. Only start the workflow after the user responds.

## Message Classification — Dev Task vs. Chat

When a message arrives in a project-bound channel, classify it before responding:

| Message type | Correct action |
|---|---|
| Feature request ("add X", "change Y to Z") | Dev task → full workflow |
| Bug report ("X is broken", "Y doesn't work") | Dev task → full workflow |
| **Error paste** (stack trace, exception, SQL error, any `Error:` / `Exception:` / `Failed:` text) | **Ask first, then dev task** — see below |
| Approval / confirmation ("all is in order", "approved") | Advance current workflow |
| Question about the app ("when was X deployed?") | Answer from project context |
| General chat | Respond conversationally |

### Error paste — ask before acting

When an error message or stack trace arrives without any accompanying explanation, **do not answer it conversationally and do not immediately launch the workflow**. Instead, ask these questions in a single message:

> "I see an error — happy to investigate and fix this. Before I start, a few quick questions:
> 1. What were you doing when this happened? (steps to reproduce)
> 2. Does it happen every time, or was it a one-off?
> 3. Any other context I should know (e.g. specific user, data, or time of day)?
>
> This will go straight to the developer so the more detail the better."

Once the user responds, include their answers verbatim in the GitHub issue body under a **Steps to Reproduce** heading, and include them in the TASK block of the Copilot prompt. If the user says it was informational or they just wanted advice, respond accordingly.

**When in doubt after clarification, treat it as a dev task.** It is better to open a tracking issue than to do nothing.

## Session Locking

If a user says **"We are only going to chat about the peter development repo"** (or any project name), lock this session to that project immediately:

1. Look up the label in `config/projects.json`
2. Confirm: _"Got it — this session is scoped to **[project]** (`[repo]`). All dev requests will use this project."_
3. Use that project's config for every request in this session **without asking again**

If the project is not in `projects.json`, ask the user to provide: repo URL, GitHub PAT, staging URL.

## Immediate Acknowledgment — Always Report Progress

**Dev tasks take 15–25 minutes.** The moment you recognize a development request, send a brief status message before starting the workflow:

> "On it! I'm setting up a dev environment for this. This will take about 15–20 minutes — I'll update you as I go. ☕"

Then proceed with the workflow and send progress updates at each phase:
- After server exists: _"Dev server is up at `<ip>`. Cloning the repo now..."_
- After clone: _"Repo cloned. Sending the task to Copilot..."_
- After Copilot development phase: _"Change implemented and tested in Docker. Deploying to staging..."_
- After staging: send the screenshot and staging URL

Use the best available tool to send these messages back to the channel. For WhatsApp, use `whatsapp_send_message` or the shell tool to call the outbound actions API if a direct send tool is available.

## Scripts Location

All scripts are at: `/data/agents/maya/workspace/skills/dev-server/scripts/`

| Script | Usage |
|---|---|
| `provision.sh <name> [--project <label>]` | Create a Hetzner dev server |
| `clone.sh <ip> <repo-url> [branch]` | Clone a repo onto the server |
| `copilot.sh <ip> "<prompt>"` | Send a task to GitHub Copilot CLI on the server |
| `screenshots.sh <ip> [--latest|--all]` | Fetch screenshots from the server |
| `disprovision.sh <name-or-id> [--force]` | Deprovision the server |
| `list.sh` | List active dev servers |

> These scripts require `HETZNER_DEV_PROJECT_API` in `~/.config/dev-server/.env` and GitHub auth at `/root/.openclaw/gh-config/hosts.yml`.

---

## SSH Key Contract

All dev servers are accessed with a **single persistent SSH key** owned by Maya:

```
Private key: /data/agents/maya/workspace/ssh/id_ed25519
Public key:  /data/agents/maya/workspace/ssh/id_ed25519.pub
```

**`provision.sh` generates this key automatically on first run** if it doesn't exist, then uploads the public key to Hetzner and installs it on every new server. All other scripts (`copilot.sh`, `clone.sh`, `screenshots.sh`, `disprovision.sh`) use this key explicitly via `-i`.

**This means:**
- The key persists across brain container restarts (workspace is bind-mounted from the host)
- Any server Maya provisions is always reachable by Maya — even after a restart
- No manual SSH key setup is ever needed

---

## Project Context — Automatic and Manual Binding

### Automatic binding (channel-injected) — PRIMARY TRIGGER

**This is how this skill is activated.** When a user joins a WhatsApp or Telegram group to a project via the **dev-server skill's `project_bindings` setting** (on the Settings page), every message from that group automatically arrives with an injected context block in your system prompt:

```
## Active Project: peter
**Repository:** leonjvr/peter (https://github.com/leonjvr/peter)
...
**Active Skill: dev-server** — This WhatsApp/Telegram group was joined to this project
via the dev-server skill's project_bindings setting. The dev-server skill is your active
workflow for this conversation. Any code change, bug fix, or feature request from this
group MUST go through the dev-server skill — follow its SKILL.md exactly.
```

**If you see `Active Skill: dev-server` in your context — this skill is active. Do not ask which project or which skill to use. Do not use any other workflow.**

1. Read the `Active Project` label from the heading (e.g. `peter`)
2. Load the full config from disk: `config/projects.json` → key `<label>` — this contains `github_pat`, `contact_channel`, deployment window, escalation config, etc.
3. Proceed immediately to the dev-server workflow using that config

The PAT in `projects.json` is needed for `clone.sh` when the repo is private — embed it in the HTTPS clone URL: `https://<github_pat>@github.com/<repo>.git`

### Multiple projects / multiple groups

Each WhatsApp/Telegram group is independently bound to a project via `contact_channel` in `projects.json`. Many groups can be active at the same time — each conversation carries its own injected `## Active Project:` block. Always reply to and escalate via the group/channel the original message came from.

### Manual session binding (unbound channels)

If no project context was injected (e.g. a direct message or unbound channel) and the user asks to work on a project:

1. Look up `<project>` in `config/projects.json`
2. If found — confirm and lock: _"Got it — this session is scoped to **[project]** (`[repo]`). All dev requests will use this project."_
3. Use this project's config for every subsequent dev request **without asking again**

If the project label is not in `projects.json`, ask the user to add it first (repo URL, PAT, staging URL).

---

## Anti-Hallucination Rules

> **CRITICAL: Never fabricate tool output, code changes, or deployment results.**

These rules apply without exception:

1. **No summary without `copilot.sh` output.** If you have not received actual stdout from `copilot.sh`, you have not made a code change. Do not write a "Summary" or "Fix Implemented" section. Do not say anything was committed, pushed, deployed, or fixed.
2. **No fake confirmations.** Never say "✅ Changes are live" or "✅ Fix committed" unless `copilot.sh` returned output that explicitly confirms this.
3. **If workflow was not started:** Say exactly: _"I haven't started work on this yet — I need more context first."_ Then ask the required clarifying questions.
4. **If a tool call returned an error or empty output:** Report the raw error. Do not invent a successful result.
5. **Verify before reporting.** Before writing any summary, confirm you have: (a) ran `copilot.sh` and received non-empty output, (b) ran `screenshots.sh` and received a screenshot path.

Violation of these rules produces false confidence in the user and is worse than saying nothing.

---

## Full Workflow

### Phase 0: Capacity Check

Before provisioning, always check:

```bash
/data/agents/maya/workspace/skills/dev-server/scripts/list.sh
```

- Count running servers. **Maximum is 3 — do not provision a 4th.**
- If a server already exists for this project, reuse it (skip Phase 1) — **but still go through Phase 3 (`copilot.sh`). Do NOT SSH in and edit files manually just because the server already exists.**
- If at capacity: inform the user and wait.

### Phase 1: Provision

```bash
/data/agents/maya/workspace/skills/dev-server/scripts/provision.sh <server-name> --project <project-label>
```

This creates a Hetzner cx23 server (2 vCPU / 4 GB / Ubuntu 24.04) and:
- Installs Node.js 24, Docker, GitHub CLI, GitHub Copilot CLI
- Copies GitHub auth (Copilot-capable token) to the server
- Configures git as `Maya <maya@nuvex.co.za>`
- Creates `/root/screenshots/` and `/root/workspace/`
- Returns JSON: `{"server_id": ..., "ip": "...", "name": "..."}`

Wait for it to complete (3–5 minutes). The IP is in the output.

### Phase 2: Clone Repo

```bash
/data/agents/maya/workspace/skills/dev-server/scripts/clone.sh <ip> <repo-url>
```

Clones the repo to `/root/workspace/<repo-name>/` on the server.

### Phase 2.5: Create GitHub Issue

Load `config/projects.json` to get `repo` and `github_pat` for this project.

Create a GitHub issue to track this task before any code work begins:

```bash
/data/agents/maya/workspace/skills/dev-server/scripts/create-issue.sh \
  "<owner/repo>" \
  "<github_pat>" \
  "<brief one-line summary of the task — 72 chars max>" \
  "**Reported by:** <sender_name> via <contact_channel>

**Request:**
<full verbatim user request>

**Opened:** <current UTC timestamp>"
```

> **Note:** The issue is created under the GitHub account that owns `github_pat`. The requester's name cannot be set as the GitHub author — this is a GitHub API limitation. Their name always appears in the body under "Reported by:".

Capture the output and store for the entire session:
- `ISSUE_NUMBER` — the GitHub issue number (integer)
- `ISSUE_URL` — the full HTML link to the issue

Notify the requester on their channel:
> "I've opened a tracking issue for this: **Issue #\<ISSUE_NUMBER\>** — \<ISSUE_URL\>"

#### Q&A Clarification Loop (if Copilot raises questions)

If Copilot raises clarification questions in PROCESS step 2, Maya must **not guess**. Instead:

1. Post the questions as a comment on the issue:
   ```bash
   /data/agents/maya/workspace/skills/dev-server/scripts/comment-issue.sh \
     "<owner/repo>" "<github_pat>" "<ISSUE_NUMBER>" \
     "**Clarification questions (pre-implementation):**

   <questions from Copilot>"
   ```
2. Relay the questions to the requester in their channel, in plain language.
3. Wait for the requester to respond.
4. Post their answers as a follow-up comment:
   ```bash
   /data/agents/maya/workspace/skills/dev-server/scripts/comment-issue.sh \
     "<owner/repo>" "<github_pat>" "<ISSUE_NUMBER>" \
     "**Answers from requester:**

   <requester's answers>"
   ```
5. Re-invoke `copilot.sh` with the answers appended to the TASK section of the prompt.

### Phase 3: Instruct Copilot — Development Task

Before building the Copilot prompt, check for a custom agent in the repo:
```bash
ssh -o StrictHostKeyChecking=no -i /data/agents/maya/workspace/ssh/id_ed25519 root@<ip> \
  "ls /root/workspace/<repo-name>/.github/agents/*.agent.md 2>/dev/null | head -3"
```
Also check for `.github/copilot-instructions.md` — if it exists, copilot will read it automatically.

- If `.github/agents/developer.agent.md` exists → prefix prompt with `@developer`
- If no developer agent → send prompt directly (copilot reads `.github/copilot-instructions.md` automatically)

Build the prompt and call copilot:

```bash
/data/agents/maya/workspace/skills/dev-server/scripts/copilot.sh <ip> "
@developer, follow this process exactly:

TASK:
<user-request-translated>

PROCESS:
1. This is the change you must make (already stated above in TASK).
2. First, plan the change. Identify every file, component, or config that needs to be touched. If anything is ambiguous or you need information that is not present in the codebase, STOP and list your clarification questions — do NOT implement until all questions are answered. Assumptions cause bugs.
3. If everything is clear, implement the change.
4. After implementation, test locally (build + run). If the change has any UI effect, use Playwright MCP to navigate to the relevant page and take a before and after screenshot. Save all screenshots to /root/screenshots/ with descriptive names (e.g. before.png, after.png). Clearly state the full file path of each screenshot in your response.
5. If local testing confirms the change is correct, commit and push to the current branch. The commit message must identify you as the author: 'feat: <short description> [Maya via Copilot]'.
6. Deploy to the staging server by following the deploy skill at .github/skills/deploy-<project>/SKILL.md. Monitor the build and deployment output — if there are any errors, fix them before continuing.
7. Once deployed to staging, test again. If the change has UI effects, use Playwright MCP to take a screenshot of the staging environment and save it to /root/screenshots/staging-final.png. Clearly state the full file path of the screenshot in your response.
8. Respond with a structured log:
   - What was changed (files and what was done)
   - Any issues encountered and how they were resolved
   - Final result: success or failure, with staging URL if deployed
   - Screenshot paths

If you are stuck fixing an error after 3 attempts, STOP and report: the exact error, the logs, and what you tried.

ISSUE TRACKING: This task is tracked as GitHub issue #<ISSUE_NUMBER> (<ISSUE_URL>).
When step 7 is complete and staging is confirmed working, close the issue with a resolution comment:
  gh issue close <ISSUE_NUMBER> --repo <owner/repo> --comment 'Resolved in staging.

Resolution: <summary of what was changed and how it was tested>
Staging URL: <staging_url>
Screenshot: <screenshot filename>
Closed: <current UTC timestamp>'

If the task cannot be completed, do NOT close the issue — leave it open for human review.
" --dir <repo-name>
```

**Translating user requests to Copilot prompts:**
- Be concrete — name files, components, or pages affected if known
- Keep the TASK section to a clear single instruction; the PROCESS template handles everything else
- If the user's request is ambiguous **before** calling Copilot, resolve it yourself first with an exploratory call:
  ```bash
  copilot.sh <ip> "Describe the login page component structure: which file controls the app name/title displayed to users? Report filename and line number." --dir <repo-name>
  ```
  Then use that knowledge to write a concrete TASK line before sending the full PROCESS prompt.

### Phase 4: Fetch Screenshots

```bash
/data/agents/maya/workspace/skills/dev-server/scripts/screenshots.sh <ip> --latest
```

Read the returned file path. Check it exists with `filesystem_read_file`. If no screenshot was saved, have Copilot retry the Playwright step.

### Phase 5: Staging Deployment

After successful dev build and screenshot confirmation, proceed directly to staging **without waiting for manual approval** unless the project config says `require_approval: true`.

**First, check if the repo has a deploy skill:**
```bash
ssh -o StrictHostKeyChecking=no -i /data/agents/maya/workspace/ssh/id_ed25519 root@<ip> \
  "cat /root/workspace/<repo-name>/.github/skills/deploy-*/SKILL.md 2>/dev/null | head -50"
```
If a deploy skill exists (e.g. `deploy-peter/SKILL.md`), it contains the exact staging server IP, SSH user, container name, and deployment commands. **Use those — do not invent a deployment procedure.**

```bash
/data/agents/maya/workspace/skills/dev-server/scripts/copilot.sh <ip> "
Deploy this to staging following the deploy skill at .github/skills/deploy-peter/SKILL.md:
1. Make sure all changes are committed on the current branch
2. Push the commit to origin
3. Follow the deploy skill exactly — use the SSH key, target IP, and commands specified there
4. After deployment, wait for the app to start (check docker logs or health endpoint)
5. Use Playwright MCP to navigate to the staging URL and take a screenshot, save to /root/screenshots/staging-final.png
6. Check server logs for any build errors or runtime issues
7. If you find errors, fix them and repeat the deploy process
8. After 3 failed attempts at fixing, stop and report the exact error, logs, and what you tried
9. When successful, report back: staging URL, screenshot saved, and a summary of what was deployed
" --dir <repo-name>
```

Then fetch the staging screenshot:
```bash
/data/agents/maya/workspace/skills/dev-server/scripts/screenshots.sh <ip> --latest
```

### Phase 5.5: Deliver Staging Result to Requester

Fetch the staging screenshot:
```bash
/data/agents/maya/workspace/skills/dev-server/scripts/screenshots.sh <ip> --latest
```

Read the screenshot file bytes using the filesystem tool and send it **inline** (not as a path or URL) to the requester via their `contact_channel`. Always include the staging URL as a clickable link.

**Adapt the language to the requester's profile.** Read their messages from this conversation to judge their level:

- **Technical profile** — uses code terms, names files, mentions APIs or Docker: respond with file names, error descriptions, what was changed technically.
- **Layman profile** — casual tone, describes what they see not how it works, no code: respond in plain language with no technical jargon.
- **When uncertain** — default to plain language.

**Technical delivery template:**
```
The change has been implemented and deployed to our staging environment.

What was changed: <brief technical summary — filename(s) and what was modified>
GitHub issue: #<ISSUE_NUMBER> — <ISSUE_URL>
Staging URL: <staging_url>

[staging screenshot attached]

Please test at <staging_url> and reply "all is in order" to proceed to production.
```

**Layman delivery template:**
```
Done! Here's what the site looks like now on our test server:

[staging screenshot attached]

You can check it out at: <staging_url>

Let us know if this is what you had in mind. If everything looks right, just reply "all is in order" and we'll push it to production.
```

### Phase 5.6: Requester Approval Gate

**Wait for the requester to confirm.** Accept any of: _"all is in order"_, _"looks good"_, _"approved"_, _"yes, deploy it"_, or similar.

If the requester reports problems or requests changes:
1. Post their feedback as a comment on the issue:
   ```bash
   /data/agents/maya/workspace/skills/dev-server/scripts/comment-issue.sh \
     "<owner/repo>" "<github_pat>" "<ISSUE_NUMBER>" \
     "**Requester feedback on staging:**

   <feedback>"
   ```
2. Re-invoke `copilot.sh` with the original PROCESS prompt, appending to the TASK section: _"The staging review found these issues — fix them: <feedback>"_
3. Loop back to Phase 5 and re-deliver the updated screenshot.

### Phase 5.7: Request Admin Approval for Production

Once the requester confirms, compose and send an approval request to the **NUVEX system administrator**:
- Load the admin's contact channel from `config/nuvex.yaml` → `system.admin.contact_channel`
- Override: use `failure_escalation.delegate` from `projects.json` if set (takes precedence over the system admin)

Check the deployment window **before sending**:
- **Inside window:** add _"We are inside the deployment window — ready to deploy now on your approval."_
- **Outside window:** add _"Note: we are currently outside the deployment window (<deployment_window_description>). Approving will schedule deployment for the next window."_

**Message to admin:**
```
🚀 Production deploy approval requested — <project>

Requested by: <sender_name>
Change: <brief one-line summary of what was implemented>
Staging: ✅ tested and confirmed by requester
GitHub issue: #<ISSUE_NUMBER> — <ISSUE_URL>
Staging URL: <staging_url>

[staging screenshot attached]

Deployment window: <deployment_window_description>
<window status note from above>

Reply "approve" to deploy to production, or "decline" to cancel.
```

**Wait for the admin's reply.** Accept: _"approve"_, _"approved"_, _"yes"_, _"go ahead"_.

If the admin declines, notify the requester on their channel that the production deployment was declined, and leave the GitHub issue open.

### Phase 6: Production Deployment

After admin approval, check the deployment window one final time. If outside the window, wait until the window opens before executing.

Instruct Copilot to deploy to production:

```bash
/data/agents/maya/workspace/skills/dev-server/scripts/copilot.sh <ip> "
Deploy to PRODUCTION following the deploy skill at .github/skills/deploy-<project>/SKILL.md:
1. Confirm all changes are committed and pushed to origin
2. Follow the deploy skill exactly — use the SSH key, target IP, and commands specified for PRODUCTION (not staging)
3. After deployment, verify the app is running (check docker logs or health endpoint at <prod_url>)
4. Use Playwright MCP to navigate to <prod_url> and take a screenshot, save to /root/screenshots/prod-final.png
5. If any errors are found, fix them before reporting success
6. After 3 failed fix attempts, stop and report the exact error and logs without making further changes
7. On success, report: production URL, screenshot path, and a one-line deployment summary
" --dir <repo-name>
```

Fetch the production screenshot:
```bash
/data/agents/maya/workspace/skills/dev-server/scripts/screenshots.sh <ip> --latest
```

#### Report to Admin

Send this to the admin's channel:
```
✅ Production deploy complete — <project>

Change: <what was deployed>
Production URL: <prod_url>
Deployed: <UTC timestamp>
GitHub issue: #<ISSUE_NUMBER> — <ISSUE_URL>

[prod screenshot attached]
```

#### Report to Requester

Adapt language to their profile and send on their `contact_channel`:

**Technical:**
```
The change is now live in production at <prod_url>.

GitHub issue #<ISSUE_NUMBER> is closed. Let us know on this channel if you run into anything.
```

**Layman:**
```
Your request is now live! 🎉

You can see the changes at: <prod_url>

Here's what was updated: <plain language summary>
[prod screenshot attached]

If anything doesn't look right, just let us know here.
```

---

### On Development or Staging Failure

Stop and escalate immediately via the project's `failure_escalation.channel`. If a `delegate` is set, notify that person. Otherwise notify the system administrator (read from `config/nuvex.yaml` → `system.admin.contact_channel`). Use this format:

```
⚠️ Dev server task failed — your involvement is needed.

Project: <project>
Task: <original user request>
GitHub issue: #<ISSUE_NUMBER> — <ISSUE_URL>
Error: <exact error message>
What was tried: <summary of attempts>

The dev server (<server-name>) is preserved for investigation.
```

**Do NOT close the GitHub issue on failure.** Do NOT destroy the server. Attach the last screenshot if available.

---

## Deployment Windows

Each project has an optional `deployment_window` in `config/projects.json`. This applies **only to production deployments** — staging deploys are always allowed.

When the staging approval comes in:
- **Inside the window:** proceed with production deployment immediately
- **Outside the window:** acknowledge and schedule: _"Staging is approved. I will deploy to production during the next window: [day] [start]–[end] [timezone]."_

To check if now is within a window: compare current UTC time converted to the project's timezone against the `day` + `start`/`end` fields.

---

## Projects Registry

Projects are stored in `/data/agents/maya/workspace/config/projects.json`. Each entry:
```json
{
  "my-project": {
    "repo": "owner/repo-name",
    "repo_url": "https://github.com/owner/repo-name",
    "github_pat": "ghp_...",
    "staging_url": "https://staging.example.com",
    "prod_url": "https://example.com",
    "deployment_window": {
      "day": "friday",
      "start": "18:00",
      "end": "22:00",
      "timezone": "Africa/Johannesburg",
      "description": "Friday evening maintenance window"
    },
    "contact_channel": "my-project-whatsapp-group",
    "failure_escalation": {
      "channel": "<contact_channel of the system admin — from nuvex.yaml system.admin.contact_channel>",
      "delegate": null
    },
    "notes": "Optional notes about the project"
  }
}
```

`contact_channel` is a WhatsApp contact name, group name, or any channel ID recognised by the messaging layer. Use the value from `config/nuvex.yaml → system.admin.contact_channel` when referring to the system administrator.

When a `--project <label>` is passed to `provision.sh`, it automatically configures the PAT, sets repo access, and exposes `PROJECT_REPO`, `PROJECT_STAGING_URL`, `PROJECT_PROD_URL` to the Copilot session.

---

## Error Protocol

### If any script fails — STOP AND FLAG

This covers ALL tools: `provision.sh`, `copilot.sh`, `clone.sh`, `screenshots.sh`, GitHub CLI, GitHub Actions.

**If GitHub Copilot CLI fails with auth/permissions error:**
- Do NOT use git, sed, curl, or raw file writes to make the change manually
- Do NOT commit via any channel other than `copilot.sh`
- Report the exact error to the user immediately

**Steps when blocked:**
1. Stop work
2. Tell the user exactly what failed and the exact error message
3. Do not destroy the server until the issue is resolved
4. Wait for the user to resolve the config issue, then retry from the beginning

---

## Server Lifecycle Rules

1. **Maximum concurrent servers**: 3 — never provision a 4th while 3 are active
2. **Minimum lifetime**: 15 minutes from creation
3. **Post-completion cooldown**: 2 hours after development is done before destroying
4. **Feedback resets timer**: New feedback extends the cooldown by 2 hours
5. **Track servers**: Check `list.sh` before provisioning to avoid duplicates
6. **Force disprovision**: If user says "disprovision now" or "force disprovision", run `disprovision.sh <name> --force`

---

## Architecture

Each dev server gets:
- **GitHub Copilot CLI** in YOLO mode (`gh copilot --allow-all --autopilot`) — no prompts, full permissions
- **MCP Servers**: Context7 (library docs), Playwright (browser + screenshots)
- **Docker + Docker Compose** for local testing
- **gh CLI** with Copilot-capable OAuth token (copied from Maya's host)
- **Git** configured as `Maya <maya@nuvex.co.za>`
- **Screenshots directory**: `/root/screenshots/`
- **Workspace directory**: `/root/workspace/`

---

## Screenshot Convention

**Copilot takes all screenshots** using the Playwright MCP server (already installed on the dev server). When instructing Copilot, always say:
> "Save all screenshots to /root/screenshots/ with descriptive filenames."

You retrieve them with `screenshots.sh`.

---

## Config Files Required (on the Brain container)

| File | Contents |
|---|---|
| `~/.config/dev-server/.env` | `HETZNER_DEV_PROJECT_API=<key>` |
| `/root/.openclaw/gh-config/hosts.yml` | GitHub OAuth token with `copilot` scope |
| `/data/agents/maya/workspace/config/projects.json` | Per-project PAT + URLs + deployment windows |

These are set up once by the operator. If missing, provision.sh will error immediately.
