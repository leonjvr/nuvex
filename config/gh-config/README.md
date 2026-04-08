# GitHub Copilot Auth — One-Time Setup

Place your GitHub CLI `hosts.yml` file here. This file contains the OAuth token 
that enables GitHub Copilot CLI (`gh copilot`) on dev servers.

## Steps

1. On a machine with an active GitHub Copilot subscription, run:
   ```
   gh auth login
   ```
   Make sure to grant `copilot` scope when prompted.

2. Find the `hosts.yml` file:
   - **Linux/macOS**: `~/.config/gh/hosts.yml`
   - **Windows**: `%APPDATA%\GitHub CLI\hosts.yml`

3. Copy it to this directory:
   ```
   cp ~/.config/gh/hosts.yml config/gh-config/hosts.yml
   ```

4. That's it. The brain container mounts this directory as `/root/.openclaw/gh-config/`.

## Security Notes

- **Never commit `hosts.yml` to git.** It is listed in `.gitignore`.
- The file contains an OAuth token — treat it like a password.
- The token must belong to a GitHub account with an active Copilot subscription.
- The `hosts.yml` is `readonly` mounted inside the container.

## Permissions Required

The GitHub account token needs:
- `repo` — for cloning private repositories (via PAT per project in `projects.json`)
- `copilot` — for `gh copilot` CLI (the OAuth token, not the PAT)
