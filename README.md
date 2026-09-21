# Telegram Alerts

A reusable TypeScript library and Bun CLI for sending Telegram notifications from scripts, scheduled tasks and applications. No runtime dependencies or third-party messaging service. The library sends through Telegram's official HTTPS Bot API; the macOS CLI adds Keychain storage, channel verification and delivery deduplication.

## Install and set up the CLI

Requires Bun 1.4+ and macOS for the CLI's Keychain integration.

```sh
bun install --frozen-lockfile
bun run setup
```

Run setup as your normal user, without `sudo`. Paste your bot's token from **@BotFather** into the hidden prompt. Setup reads the bot identity from Telegram, saves its token in Keychain, discovers a channel, verifies Post Messages permission and asks you to confirm the destination before sending a connection test.

If discovery finds nothing, publish a short message in the intended channel and retry. If multiple channels are available, provide the numeric channel ID:

```sh
bun run setup -1001234567890
```

Discovery does not remove existing bot webhooks. If another service owns the bot's webhook or consumes its updates, use an explicit channel ID.

## Send notifications

```sh
bun run status
bun run preview preview.json
bun run send /absolute/path/to/alert.json
```

The JSON input needs only `id` and `text`:

```json
{
  "id": "backups:daily:2026-09-21",
  "text": "Daily backup completed successfully."
}
```

Send and preview also accept JSON on stdin. Use a stable, namespaced ID to avoid collisions between applications sharing the CLI's receipt store. The CLI sends only to its configured numeric channel ID, even if the channel is renamed.

AI-generated alerts may additionally provide **both** `model` and `reasoning`. These add a prefix such as `[GPT-5.6 Luna · Reasoning: High]`. Omit both for ordinary notifications. The library does not call an AI model or verify caller-supplied model metadata.

The final plain-text message is limited to 4096 characters. Link previews are disabled. Token-like strings are rejected from message bodies.

## Library usage

The package exports `sendAlert`, `parseAlert`, `formatAlert`, `SafeError`, and the `Alert` type from `src/index.ts`. This is a private source package; use a local path dependency from another Bun project:

```sh
bun add /absolute/path/to/telegram-alerts
```

```ts
import { sendAlert } from "telegram-alerts";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Configure the bot token in your secret store.");

const messageId = await sendAlert(
  { token, chatId: -1001234567890 },
  { id: "deployments:release-42", text: "Release 42 deployed successfully." },
);
```

The library accepts a Telegram chat ID directly, so it can also target groups or private chats where the bot has access. It does not read Keychain, load CLI configuration, schedule jobs, retry sends or deduplicate IDs. Library callers own those concerns. A successful call returns Telegram's message ID; an unconfirmed response throws. The CLI wraps this function with channel checks and a persistent receipt store.

## Credentials and configuration

New CLI installations store configuration and receipts under `~/Library/Application Support/telegram-alerts/`. Set `TELEGRAM_ALERTS_DATA_DIR` to an absolute directory to keep separate configurations and receipts for different integrations. Set the same value for setup, status and send.

The token is stored in macOS Keychain under service `telegram-alerts.telegram`, with the bot username as the account. It is supplied to the Keychain tool through stdin rather than process arguments. The token remains in process memory while requests run. Configuration contains the bot username, numeric channel ID and Keychain service reference; it contains no token.

Earlier installations used `~/Library/Application Support/gfi-alerts/` and service `gfi-alerts.telegram`. When an existing configuration is found there and no explicit data directory is selected, it continues to be used. This preserves credentials and deduplication receipts without migration or re-entry.

## Reliability and scheduling

The CLI writes a pending receipt before sending and records Telegram's message ID after success. Confirmed duplicate IDs are suppressed. An interrupted or timed-out send may have reached Telegram; pending receipts therefore block automatic retries. Inspect the destination before removing the exact pending receipt or issuing a new ID.

A scheduler should run `status`, prepare an alert JSON file, then invoke `bun /absolute/path/to/telegram-alerts/src/cli.ts send /path/to/alert.json`. Treat a nonzero exit code as a failure requiring attention. Application-specific monitoring logic and schedules belong in the calling application or task.

For unattended local runs, keep the Mac awake and the login Keychain unlocked. The scheduler needs permission to execute Bun, access the configuration and Keychain, write receipts and reach `api.telegram.org`. Verify the first scheduled run; interactive success alone does not prove unattended access.

## Development

```sh
bun run check
bun test
```

Network tests use mocked responses. The macOS parser regression test runs the read-only `security help` command and does not read or write credentials.

API reference: https://core.telegram.org/bots/api
