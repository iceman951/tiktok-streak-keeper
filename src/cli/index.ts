import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ZodError } from 'zod';
import { login } from '../auth/index.js';
import { withProfileLock } from '../browser/index.js';
import { dataDirectory, loadConfig, recipientSchema } from '../config/index.js';
import { History } from '../database/index.js';
import { logger } from '../logger/index.js';
import { startScheduler } from '../scheduler/index.js';
import { createMessenger, inspectChats } from '../tiktok/adapter.js';
import { runMessages } from '../tiktok/runner.js';
import { AppError, errorCode } from '../utils/errors.js';

const hints = {
  AUTH_REQUIRED: 'Run bun run login. If already logged in, verify the authenticated UI selector.',
  SECURITY_CHALLENGE:
    'Automation stopped. Resolve the restriction manually; no bypass is attempted.',
  UI_CHANGED:
    'Verify selectors, a single matching conversation, and an empty composer; see README.',
  IDENTITY_MISMATCH: 'The selected conversation does not match its approved username.',
  TRANSIENT_NAVIGATION:
    'Navigation or browser startup failed after bounded retries. Check connectivity and Chromium installation.',
  SEND_UNCERTAIN:
    'Inspect TikTok manually. Today’s reservation remains blocked to prevent duplicates.',
  DAY_CHANGED:
    'The local calendar day changed before submission. Inspect status before another run.',
  LOCKED:
    'Another command owns the browser profile, or its lock is recovering (up to two minutes).',
  UNEXPECTED:
    'Check config.json, paths, permissions, database timezone, and browser installation; see README.',
} as const;

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !['login', 'chats', 'dry-run', 'send', 'start', 'status'].includes(command)) {
    process.stdout.write(
      'Commands: login | chats [--select N --username USER] | dry-run | send | start | status\n',
    );
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const dataDir = dataDirectory();
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (command === 'login') {
    await withProfileLock(dataDir, () => login(config, dataDir));
    return;
  }
  if (command === 'chats') {
    await withProfileLock(dataDir, async () => {
      const candidates = await inspectChats(config, dataDir);
      // Explicit inspection output is local/private; never sent to structured logs.
      process.stdout.write(
        JSON.stringify(
          candidates.map((chat, i) => ({ number: i + 1, ...chat })),
          null,
          2,
        ) + '\n',
      );
      const args = process.argv.slice(3);
      const selection = args.indexOf('--select');
      if (selection >= 0) {
        const candidate = candidates[Number(args[selection + 1]) - 1];
        const usernameIndex = args.indexOf('--username');
        if (!candidate || usernameIndex < 0) throw new Error('Use --select N --username USER');
        const draft = recipientSchema.parse({
          username: args[usernameIndex + 1],
          conversationUrl: candidate.conversationUrl,
          approved: false,
        });
        process.stdout.write(
          'Verify this username in the conversation header, then add and approve it in config.json:\n' +
            JSON.stringify(draft, null, 2) +
            '\n',
        );
      }
      if (!candidates.length)
        process.stdout.write(
          'No stable conversation links found. See README for manual calibration; no accounts were selected.\n',
        );
    });
    return;
  }
  const history = new History(join(dataDir, 'history.sqlite'), config.timezone);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (command === 'status') {
      process.stdout.write(
        JSON.stringify(
          {
            mode: config.dryRun ? 'dry-run' : 'live',
            schedule: config.schedule,
            timezone: config.timezone,
            approvedRecipients: config.recipients.filter((r) => r.approved).length,
            session: 'Not checked; use login or test:send',
            history: history.recent(),
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    if (!config.recipients.some((r) => r.approved))
      throw new Error('Configure at least one approved recipient');
    const run = () =>
      withProfileLock(dataDir, (checkLock) =>
        runMessages(config, command === 'dry-run', {
          history,
          messenger: () => createMessenger(config, dataDir),
          assertSafe: () => {
            checkLock();
            if (controller.signal.aborted) throw new AppError('LOCKED');
          },
          wait: (ms) => delay(ms, undefined, { signal: controller.signal }),
        }),
      );
    if (command === 'start') await startScheduler(config, run, controller.signal);
    else if ((await run()).failed > 0) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    history.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ZodError) {
    logger.error(
      { issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) },
      'Invalid configuration; compare with config.example.json',
    );
  } else {
    const code = errorCode(error);
    logger.error({ code }, hints[code]);
  }
  process.exitCode = 1;
});
