# Hourly Heartbeat Tasks

- Check any pending tasks or reminders.
- Review things Leon mentioned that need follow-up.
- If new information unblocks a task, continue it.
- If a task is actionable and within scope, do the work.

## Dev Server Check

If any dev servers are running (`skills/dev-server/scripts/list.sh`):

- If any server is older than 4 hours with no active tracked task, flag it to Leon immediately.
- If a server is in a failed state, destroy it immediately — no cooldown applies.
- Do not let servers idle silently. Every running server should have a tracked task.

## When to Reach Out

- Important message arrived that needs Leon's attention
- Something time-sensitive is coming up
- A dev server needs attention
- It's been >8h since you last said anything

## When to Stay Quiet (HEARTBEAT_OK)

- Late night (23:00–08:00) unless urgent
- Nothing new since last check
- You just checked <30 minutes ago
