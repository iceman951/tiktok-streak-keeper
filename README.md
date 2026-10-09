# TikTok Streak Keeper

A small, local TypeScript CLI that attempts one direct message per approved TikTok recipient per calendar day. Uses Playwright, node-cron, SQLite, Zod, and Pino. Dry-run is the default.

**Live TikTok messaging has not been verified.** The browser adapter is implemented and tested against an intercepted inbox fixture. TikTok's selectors, authenticated state, conversation deep links, and outgoing-message evidence must be calibrated against your account. The example selectors are illustrative, not a claim about TikTok's current interface. If your account does not expose a stable conversation URL and a unique recipient profile link in its conversation header, this version cannot safely automate it.

Sending a message does not guarantee a streak. TikTok controls streak eligibility, timing, and recipient participation. This is an unofficial personal tool, without stealth, CAPTCHA bypass, proxy rotation, or security evasion.

## Prerequisites

- Node.js **22.13+**, preferably a maintained LTS release, and npm. The built-in `node:sqlite` API avoids a native SQLite dependency; some Node releases print an experimental warning.
- Windows, macOS, or Linux with a desktop available for manual Chromium login.
- An account allowed to use TikTok direct messages and existing conversations with consenting recipients.
- A persistent, private local disk. Keep the browser profile and history on one machine, outside network shares and cloud-synced folders such as OneDrive.

## Installation

```sh
npm ci
npm run browser:install
```

On Linux, Playwright may require OS packages: `npx playwright install --with-deps chromium`. See [Playwright browser installation](https://playwright.dev/docs/browsers).

Create private configuration files:

```powershell
# Windows PowerShell
Copy-Item config.example.json config.json
Copy-Item .env.example .env
```

```sh
# macOS / Linux
cp config.example.json config.json
cp .env.example .env
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` and `npx.cmd` in these commands. There is no need to change your execution policy.

Set `DATA_DIR` in `.env` to a private directory outside a synced checkout, for example `C:/Users/YOU/AppData/Local/tiktok-streak-keeper` on Windows. Other examples are `/Users/YOU/Library/Application Support/tiktok-streak-keeper` or `/home/YOU/.local/share/tiktok-streak-keeper`. Paths may be absolute; relative paths resolve from the working directory. Always launch commands from the project root. `.env` never needs a password or token.

## Manual login

```sh
npm run login
```

A visible, dedicated Chromium profile opens. Sign in yourself, complete any legitimate verification, open your inbox, then press Enter in the terminal. No credentials are collected by this tool. Closing the persistent context saves the session under `DATA_DIR/browser-profile`.

The login check requires your configured `ui.authenticated` selector and no visible login/challenge indicator. If it fails while you are signed in, calibrate those selectors and repeat. Session cookies are still local; the command does not export them. Expiration halts sending with `AUTH_REQUIRED`; run `login` again. Do not point this at your everyday Chrome profile or share the profile between processes. See [Playwright persistent contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).

## Calibrate the TikTok adapter

Keep `dryRun: true` and `ui.verified: false` while inspecting the visible browser manually with its developer tools. Selectors live in `config.json`, so UI changes do not require code edits. Prefer stable test attributes or accessible roles where available. All selectors must match your UI language and account variant.

| UI field               | Required evidence                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `authenticated`        | A visible element present only for your signed-in account                                          |
| `loginRequired`        | Visible login/expired-session prompt                                                               |
| `securityChallenge`    | Visible verification, CAPTCHA, or restriction UI; include variants observed on your account        |
| `conversationLinks`    | Actual anchors to distinct, stable conversation URLs; used only by `chats`                         |
| `conversationRoot`     | Exactly one visible active conversation container                                                  |
| `recipientProfileLink` | Exactly one visible header link inside that container, with `/@username` identifying its recipient |
| `composer`             | Exactly one visible, editable textbox inside the container                                         |
| `sendButton`           | Exactly one visible send control inside the container; must be enabled after filling               |
| `outgoingMessages`     | Text elements of **your outgoing messages only**, inside the container                             |
| `sendFailure`          | Visible sending-failed, rate-limit, or delivery-error state inside the container                   |

Selectors other than authentication/challenge/root/conversation links are scoped to `conversationRoot`. Do not match arbitrary profile links, incoming messages, or a display name. Group chats and display-name-only identification are unsupported. Missing, duplicated, changed, or mismatched elements halt the run. A selector that is too broad can invalidate evidence, so review this carefully before live mode.

Success means a new exact-text outgoing element appears, the composer clears, and those observations persist after a one-second recheck with no configured error indicator. This is UI submission evidence, **not proof of server delivery, read receipt, or a maintained streak**. Outgoing optimistic bubbles and late server errors remain a limitation. A changed/virtualized message list can also cause a conservative uncertain result.

## Recipient configuration

```sh
npm run chats
npm run chats -- --select 1 --username friend.username
```

`chats` inspects currently rendered conversation links, without opening recipients or sending messages. It does not scrape all followers, scroll for unrelated accounts, or infer identity from display names. Selection prints an **unapproved** JSON draft; it never changes the allowlist. Output may contain private conversation details, so do not share it unredacted.

Verify the selected URL opens the intended existing one-to-one conversation after a fresh navigation, and confirm its exact username in the header. Add it to `config.json`:

```json
{
  "username": "friend.username",
  "conversationUrl": "https://www.tiktok.com/messages/REPLACE_WITH_REAL_THREAD_ID",
  "approved": true,
  "messageTemplate": "Hi {username}! 👋"
}
```

The URL above is a format example, not a known TikTok route. Preserve the actual stable URL you observed. Only HTTPS `www.tiktok.com/messages` routes identifying a conversation are accepted; a generic inbox or profile URL is insufficient. The adapter independently checks the header username after navigation and again before clicking. If TikTok exposes no such URL, inspection reports no supported links; stop rather than inventing IDs or weakening identity checks.

Start with one recipient. Once a dry-run succeeds, add other approved conversations (maximum 20). Usernames are case-insensitive database keys; changing a display name does not reset history. Account renames, account switching, or changing conversation identities require manual review. Use a separate data directory and config per sender account, and do not rename identities mid-day to bypass history.

`messageTemplates` is a nonempty array of one-line strings. Templates rotate deterministically by calendar day; a recipient's `messageTemplate` overrides this. Supported substitutions: `{username}` and `{date}`. Config rejects unknown placeholders, control characters, duplicate recipients, invalid timezones, and schedules more frequent than daily. No template text is written to structured logs.

## Dry-run and live mode

```sh
npm run test:send
```

This always forces dry-run, even if live mode is configured. It opens approved conversations, verifies identity and UI readiness, and records a dry-run event. It does **not** fill the composer or click Send. Dry-runs do not consume the daily send reservation. Existing drafts cause a safe failure rather than being overwritten. A dry-run cannot validate the post-send evidence selector; manually inspect an existing outgoing message to calibrate it.

To enable live automation, after verifying your selectors and approved recipients, explicitly set all three:

```json
{
  "dryRun": false,
  "liveSendingEnabled": true,
  "ui": { "verified": true }
}
```

These are fields to update in the full configuration, not a replacement file; retain the other `ui` fields. Then run:

```sh
npm run send
```

`send` remains dry-run under the default configuration. Setting `dryRun: false` without both other switches is a validation error. `approved: false` recipients are always ignored. Live sends are sequential, with a default 60-second interval (minimum 30). This limits load; it is not a claim about TikTok's permitted rate.

## Scheduling

```sh
npm run start
```

Default: **20:00 Asia/Bangkok**, once daily. Change `schedule` using `HH:mm` and `timezone` using an IANA zone. Configuration is loaded at process start; restart after edits. Cron uses the configured timezone and prevents overlap. The browser is opened only for work and closed afterward. See [node-cron scheduling options](https://nodecron.com/scheduling-options.html).

Keep the machine awake and the process running. There is no immediate startup send or missed-run catch-up after sleep/downtime; use `send` manually if appropriate. Repeated daylight-saving hours still share one SQLite calendar-day key. Nonexistent local times can be skipped. Bangkok has no DST.

Ctrl+C or SIGTERM stops scheduling and prevents further submissions at the next safety checkpoint, then closes the browser/database. An in-progress browser operation can take its bounded timeout to settle; do not force-kill unless necessary. In-flight reservations survive either case.

For unattended use, run from a local OS service or Task Scheduler with the same user, working directory, `.env`, and data directory. Linux headless servers can use `headless: true` after interactive login on a compatible environment; session portability is not guaranteed. Docker is not included: interactive login needs a display, and browser profiles/history need private persistent volumes. Cloudflare Workers are not used.

## History, duplicate protection, and recovery

```sh
npm run status
```

Shows mode, schedule, approved count, and the latest 50 delivery/event records. This is private terminal output, including usernames; it omits message bodies and does not check authentication or whether another scheduler is running. SQLite stores the actual message, username, calendar day, UTC timestamp, and status locally.

| Status      | Meaning and next action                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `dry-run`   | Validation only; a later live attempt is allowed                                  |
| `failed`    | Pre-submission failure; review the error code before retrying                     |
| `pending`   | Durable reservation, possibly interrupted during submission; blocked for that day |
| `sent`      | UI submission evidence observed; blocked for that day                             |
| `uncertain` | Reservation exists but outcome cannot be proved; blocked for that day             |

A unique `(lowercase username, calendar day)` key and an atomic SQLite insert reserve each live attempt **before** filling/clicking. SQLite uses WAL and FULL synchronous writes. Concurrent connections cannot reserve the same recipient/day. There is no automatic expiry or retry of a pending/uncertain submission, including after restart. This deliberately favors missing a message over sending duplicates; exactly-once delivery cannot be guaranteed across browser, server, and process failures.

If an attempt is pending/uncertain, inspect TikTok manually and leave the record in place. There is no force-resend/reset command. The next calendar day has a new allowance. Never delete history or switch data directories to retry an uncertain send. Manual messages outside this tool are not deduplicated; the tool coordinates only its own attempts. Changing the configured timezone for an existing database is refused to avoid splitting a calendar day into different keys.

A process/profile lock prevents competing browser commands. It can take two minutes to recover after an abrupt process death. The durable delivery reservation remains authoritative even if a stale process lock is recovered. Chromium also protects its profile against simultaneous launches. Do not run multiple hosts against a shared/synced profile or database.

Only transient navigation/browser-startup failures before submission are retried: at most three attempts with 1s and 2s backoff, recreating the browser between attempts. Identity, authentication, challenge, and UI failures halt immediately. Any reserved attempt that errors is uncertain and halts the batch. Repeated transient failures stop the batch; the scheduler also stops after the configured number of consecutive failed runs. Restart after manual diagnosis.

## Troubleshooting

- **No recipients:** add at least one verified conversation with `approved: true`.
- **`AUTH_REQUIRED`:** run `login`; verify the signed-in selector if you are already authenticated.
- **`SECURITY_CHALLENGE`:** stop automation and address the restriction manually. No automated CAPTCHA or 2FA handling is provided.
- **`UI_CHANGED` / `IDENTITY_MISMATCH`:** inspect the active header, unique locators, empty composer, and outgoing-only selectors. Keep dry-run on while fixing them.
- **`TRANSIENT_NAVIGATION`:** check network connectivity and `npm run browser:install`. A blocked platform is not retried indefinitely.
- **`LOCKED`:** close the competing command, or wait two minutes after a crash. Do not remove a lock while a browser is active.
- **`UNEXPECTED`:** verify the config file exists, compare it with the example, confirm filesystem permissions and that the database timezone matches. Raw browser errors are intentionally suppressed because they may contain private data.
- **No supported chats:** your UI may not expose stable deep links or may use buttons instead of anchors. This version fails safely and requires an adapter update; it does not fall back to display names.
- **Login works but nothing is sent:** check all three live opt-ins, recipient approvals, today's history, and whether the configured schedule has occurred while the process was running.
- **SQLite locked or damaged:** stop all processes, preserve the database and WAL files together, and inspect locally before restarting. Do not create a fresh database to retry unknown outcomes.

## Account safety and restrictions

TikTok may restrict automated access or messaging and may change its UI at any time. Review the terms and rules applicable to your account before enabling automation. Respect account restrictions and recipient consent; this project is for a small, explicit personal allowlist, not bulk messaging. No particular send interval makes automation platform-approved.

The browser profile is equivalent to access to your signed-in account. Protect it with OS account permissions, disk encryption, and private backups. `DATA_DIR` contains sensitive browser storage and plaintext SQLite message history. POSIX directories are created with private mode where supported; Windows uses inherited ACLs, which you must keep private. Git ignores `data/`, `.env*`, local `config.json`, and database/log artifacts. If you choose a custom data directory inside another repository, protect that path separately. Never commit screenshots, traces, cookies, tokens, or profiles.

Pino logs only controlled event metadata and error codes, with additional sensitive-field redaction. It does not log raw exceptions, DOM snapshots, cookies, URLs, usernames, or message text. `chats` and `status` are explicit private inspection outputs and should be redacted before sharing. Traces/screenshots and browser network logging are not enabled.

## Development and verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
# Or all checks except build:
npm run check
```

`npm test` includes database/restart checks, timezone scheduling, config validation, bounded retries, allowlist enforcement, mock send failures, and real Chromium interaction with a fully intercepted fake inbox. Every fixture request is fulfilled or aborted locally; no real TikTok request, authenticated profile, or live message is used. Chromium must be installed first. CI can use the included workflow on Windows, macOS, and Linux.

Build outputs go to `dist`; for example `node dist/cli/index.js status`. SQLite reference: [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html).

```text
src/
  cli/        command dispatch, private inspection output, shutdown
  config/     Zod schemas and local configuration
  browser/    persistent Chromium and process/profile lock
  auth/       interactive login
  tiktok/     guarded UI adapter and daily send pipeline
  scheduler/  daily cron and failure circuit
  database/   durable reservations and message history
  logger/     safe structured logs
  utils/      timezone dates, errors, bounded retries
tests/        offline unit and browser-fixture tests
data/         ignored runtime state
```
