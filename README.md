# Telegram Alerts

A local TypeScript sender for your Coop → Miles & More monitor. Uses Bun 1.4+ and Telegram's official HTTPS Bot API, with no runtime dependencies or third-party messaging service. macOS only, because credentials live in Keychain.

## One-time setup

```sh
cd ~/dev/github/telegram-alerts
bun install
bun run setup
```

Paste the token from **@BotFather → @gfi_alerts_chatgpt_bot** into the hidden Terminal prompt. It is validated against the bot username and saved to the login Keychain as service `gfi-alerts.telegram`, account `gfi_alerts_chatgpt_bot`. No token is written to a project file, shell history or process argument. Keychain may ask you to allow access to `/usr/bin/security`; approve only the access you intend. The token remains sensitive in process memory while requests run.

Setup discovers **GFI Alerts** from recent bot membership/channel updates, verifies the channel and the bot's Post Messages permission, asks you to confirm its numeric ID, and sends a clearly labeled setup test. If discovery finds nothing, post a short message in the channel and rerun setup. If multiple channels share the name, use `bun run setup -100YOUR_CHANNEL_ID` for the intended channel. Existing webhooks can prevent discovery; setup does not remove them.

Configuration and delivery receipts are stored under `~/Library/Application Support/gfi-alerts/` with owner-only permissions. The configured numeric channel ID is fixed for all sends; callers cannot select another destination.

## Use

```sh
bun run status
bun run preview preview.json
bun run send /absolute/path/to/alert.json
```

Send/preview also accept JSON on stdin. Required fields: `id` (stable campaign/version identifier), `model` (actual running model), `reasoning` (actual setting or `Unknown`), and `text` (plain text with official sources and deadline). `preview.json` is illustrative metadata; the sender does not invoke an AI model or independently verify caller-supplied model labels.

Successful deliveries are deduplicated by `id`. Use a new version only for a material offer change. A pending receipt is written before sending: if connectivity fails or a process stops, delivery may be uncertain. The sender does not retry automatically. Inspect Telegram before manually removing the exact pending receipt or choosing a new ID. Receipts are retained locally.

## Scheduled monitor

The existing Codex task performs research every two days; this project handles delivery only. The task should check `status`, prepare an alert JSON file, and run `bun /Users/hybrid/dev/github/telegram-alerts/src/cli.ts send /path/to/alert.json`. Mark an alert delivered only after success. Report setup, permission or delivery failures in the task. Never include tokens in prompts, messages, logs or JSON inputs.

Keep the Mac awake, Codex running, and the login Keychain unlocked. The scheduled run must have permission to read Keychain/config, write delivery receipts and reach `api.telegram.org`. Interactive success does not prove unattended execution; inspect the first scheduled run. No broad permission changes are installed by this project.

The sender cannot switch the scheduled task's model. Select Luna with High reasoning in the task settings; alert metadata must reflect the model actually used.

## Development

```sh
bun run check
bun test
```

Tests use mocked network responses and do not access Keychain or send messages.

API reference: https://core.telegram.org/bots/api
