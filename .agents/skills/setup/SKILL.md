---
name: setup
description: Run initial NanoClaw setup. Use when user wants to install dependencies, authenticate messaging channels, register their main channel, or start the background services. Triggers on "setup", "install", "configure nanoclaw", or first-time setup requests.
---

# NanoClaw Setup

Bring a fresh or partially configured NanoClaw install to a working state.

Setup should do the work directly whenever the action is local, reversible, and low risk. Only pause when user action is genuinely required:
- choosing between valid setup paths
- authenticating a channel or completing a GUI flow
- placing a secret into `.env`
- approving a high-risk repository or system change

Use `bash setup.sh` for bootstrap, then `npx tsx setup/index.ts --step <name>` for scripted checks and state changes. Steps emit structured status blocks to stdout. Verbose logs go to `logs/setup.log`.

## Execution Policy

- Detect current state before modifying anything.
- Prefer non-destructive changes. Do not rewrite git remotes, overwrite config, or force-push unless the user explicitly confirms.
- Do not ask the user to paste secrets into chat. Secrets should be written locally into `.env`.
- If a dependency is missing and can be installed safely, install it. If the install path depends on privileges or GUI approval, explain the next action and continue once the user has completed it.
- Re-run the relevant setup step after each fix instead of assuming the fix worked.
- If a delegated skill is unavailable, say so briefly and continue with the rest of setup instead of blocking the whole workflow.

## Interaction Rules

- Keep questions short and decision-oriented. Offer a recommended default when there is one.
- Ask before any destructive or account-affecting action, including:
  - renaming git remotes
  - changing the user's push target
  - force-pushing
  - replacing existing credentials
  - switching container runtime implementations
- When a choice is optional and the user does not care, pick the lower-risk default and proceed.

## 0. Preflight

Gather baseline state before making changes.

Run:
- `git remote -v`
- `bash setup.sh`
- `npx tsx setup/index.ts --step environment`

Record:
- platform and whether WSL is in use
- Node.js status
- dependency and native module status
- whether `.env` exists
- whether auth is already configured
- whether any groups are already registered
- whether Docker and Apple Container are installed/running

Use the results from this step to drive later decisions. Do not repeat discovery unless the environment changes.

## 1. Git Remotes

Preferred remote layout:
- `origin` -> user's fork
- `upstream` -> `https://github.com/qwibitai/nanoclaw.git`

Rules:
- Do not rename remotes or push branches without explicit confirmation.
- Do not use `git push --force` as part of the default setup path.
- If the user cloned upstream directly, recommend creating a fork, but allow them to continue without one.

Cases:

**Case A - `origin` points to `qwibitai/nanoclaw`:**

Explain that a fork is recommended so customizations can be pushed safely.

Offer:
- set up a fork now
- continue without a fork

If the user chooses a fork:
- ask for their GitHub username after they create the fork in the browser
- rename `origin` to `upstream` only with explicit confirmation
- add the fork as `origin`
- verify remotes with `git remote -v`

If the user chooses to continue without a fork:
- add `upstream` only if it is missing and non-conflicting

**Case B - `origin` points to the user's fork and `upstream` is missing:**

Add `upstream`:

```bash
git remote add upstream https://github.com/qwibitai/nanoclaw.git
```

**Case C - `origin` points to the user's fork and `upstream` exists:**

Continue.

Success criteria:
- remotes are valid for the user's chosen workflow

## 2. Bootstrap

Bootstrap with:

```bash
bash setup.sh
```

Parse the status block.

- If `NODE_OK=false`, offer to install Node.js 22. Choose the safest available method for the platform.
- If `DEPS_OK=false`, inspect `logs/setup.log`, repair the dependency state, then retry.
- If `NATIVE_OK=false`, install the required build tools, then retry.

Common repairs:
- remove and reinstall `node_modules` if dependency state is corrupted
- install build tools when native modules fail
- re-run `bash setup.sh` after each change

Success criteria:
- bootstrap reports Node, dependencies, and native modules as healthy

## 3. Container Runtime

Choose the runtime from the preflight results.

### 3a. Choose runtime

- `PLATFORM=linux`: Docker is the only supported runtime
- `PLATFORM=macos` and Apple Container is installed: ask the user to choose between Docker and Apple Container
- `PLATFORM=macos` and Apple Container is not installed: use Docker

Default to Docker unless the user explicitly wants Apple Container on macOS.

### 3b. Install or start the chosen runtime

For Docker:
- if `DOCKER=running`, continue
- if `DOCKER=installed_not_running`, start it and re-check with `docker info`
- if `DOCKER=not_found`, offer to install it

For Apple Container:
- if the runtime is not installed, stop and ask the user whether they want to install and use it

Do not assume package manager access, GUI availability, or root privileges. Check first.

### 3c. Apple Container conversion gate

If the chosen runtime is Apple Container, verify whether the codebase has already been converted from Docker:

```bash
grep -q "CONTAINER_RUNTIME_BIN = 'container'" src/container-runtime.ts && echo "ALREADY_CONVERTED" || echo "NEEDS_CONVERSION"
```

- If `NEEDS_CONVERSION`, run `/convert-to-apple-container` before building
- If `ALREADY_CONVERTED`, continue

If the chosen runtime is Docker, skip this step.

### 3d. Build and test

Run:

```bash
npx tsx setup/index.ts --step container -- --runtime <chosen>
```

Parse the status block.

- If `BUILD_OK=false`, inspect `logs/setup.log`, repair the cause, and retry
- If the failure looks like stale build cache, clear the runtime builder cache and retry
- If `TEST_OK=false` but `BUILD_OK=true`, treat it as a runtime readiness or smoke-test issue and retry after confirming the runtime is actually up

Success criteria:
- container image builds successfully
- smoke test passes

## 4. Authentication Credentials

Inspect `.env` if present and check for supported credentials.

If credentials already exist, ask whether to keep them or reconfigure them.

Supported credential modes should be described using the actual variables and commands used by this repository. Keep the terminology consistent. Do not mix provider names loosely.

Rules:
- never ask the user to paste secrets into chat
- ask the user to write the chosen secret into `.env`
- after the user confirms, re-check `.env` locally and continue

Success criteria:
- required credential variables are present in `.env`

## 5. Channels

Ask which messaging channels to enable.

Supported channels:
- WhatsApp
- Telegram
- Slack
- Discord

Delegate to each channel's own skill instead of duplicating channel-specific setup logic:
- `/add-whatsapp`
- `/add-telegram`
- `/add-slack`
- `/add-discord`

Each delegated skill is expected to handle:
1. installing the channel code
2. collecting or validating channel credentials
3. authenticating the channel
4. registering the target chat with the correct identifier
5. building and verifying its own changes

After all selected channel skills finish, rebuild once:

```bash
npm install && npm run build
```

If the rebuild fails:
- inspect the error
- fix the missing dependency or merge issue
- retry

If a selected channel skill is unavailable:
- say so clearly
- skip that channel instead of blocking the rest of setup

Success criteria:
- at least one selected channel authenticates successfully
- selected chats are registered when required by the channel

## 6. Mount Allowlist

Ask whether agents should be allowed to access external directories.

If no:

```bash
npx tsx setup/index.ts --step mounts -- --empty
```

If yes:
- collect the allowed roots and any restrictions
- apply them with the JSON form expected by the mounts step

Success criteria:
- mount configuration exists and matches the requested policy

## 7. Start Service

If a stale service is already running, stop or unload it first using the platform-appropriate command.

Run:

```bash
npx tsx setup/index.ts --step service
```

Parse the status block.

Special cases:

- If `FALLBACK=wsl_no_systemd`, explain the two supported paths:
  - enable systemd in WSL and retry
  - use the generated `start-nanoclaw.sh` wrapper

- If `DOCKER_GROUP_STALE=true`, explain that the current session cannot yet access the Docker socket reliably. Give the exact remediation steps and then re-run the service step after the user confirms they are complete.

- If `SERVICE_LOADED=false`, inspect the service logs and platform status commands, repair the issue, and retry.

Success criteria:
- service is loaded
- service is running

## 8. Verify

Run:

```bash
npx tsx setup/index.ts --step verify
```

Parse the result and repair each failed check.

Typical fixes:
- `SERVICE=stopped`: rebuild if needed, then restart the service
- `SERVICE=not_found`: re-run step 7
- `CREDENTIALS=missing`: re-run step 4
- `CHANNEL_AUTH=not_found`: re-run the relevant channel skill
- `REGISTERED_GROUPS=0`: re-run the relevant channel skill
- `MOUNT_ALLOWLIST=missing`: re-run step 6

Setup is complete only when all of the following are true:
- service is running
- required credentials are present
- at least one configured channel is authenticated
- at least one chat or group is registered
- mount policy exists
- container verification passes

At the end, tell the user how to perform a real-world check:
- send a test message in the registered chat
- watch runtime logs with `tail -f logs/nanoclaw.log`

## Troubleshooting

**Service not starting**
- inspect `logs/nanoclaw.error.log`
- check for wrong Node path, missing `.env`, or missing channel credentials
- re-run the service step after fixing the cause

**Container agent fails**
- confirm the selected runtime is actually running
- inspect `groups/main/logs/container-*.log`
- retry the container step after the runtime is healthy

**No response to messages**
- verify trigger pattern and main-channel behavior
- run the verify step
- inspect `logs/nanoclaw.log`

**Channel not connecting**
- confirm the required credentials are present in `.env`
- confirm channel-specific auth artifacts exist when applicable
- restart the service after any `.env` change

## Notes for the Agent

- Favor progress over explanation. Fix what is fixable and move on.
- Be conservative with repository-shaping operations and credential changes.
- Treat this skill as an orchestrator. Use channel skills and runtime-conversion skills rather than copying their internals here.
