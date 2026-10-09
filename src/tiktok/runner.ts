import type { Config, Recipient } from '../config/index.js';
import type { History } from '../database/index.js';
import { logger } from '../logger/index.js';
import { AppError, errorCode, fatalForRun } from '../utils/errors.js';
import { retryNavigation } from '../utils/retry.js';
import { calendarDay, sleep } from '../utils/time.js';
import type { Messenger } from './adapter.js';

export interface RunResult {
  sent: number;
  dryRun: number;
  skipped: number;
  failed: number;
  halted: boolean;
}
export interface RunDependencies {
  history: History;
  messenger: () => Promise<Messenger>;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
  assertSafe?: () => void;
}

export function renderMessage(config: Config, recipient: Recipient, day: string): string {
  const index =
    Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000) % config.messageTemplates.length;
  const template = recipient.messageTemplate ?? config.messageTemplates[index];
  if (!template) throw new AppError('UI_CHANGED');
  return template.replaceAll('{username}', recipient.username).replaceAll('{date}', day);
}

export async function runMessages(
  config: Config,
  forceDryRun: boolean,
  dependencies: RunDependencies,
): Promise<RunResult> {
  const { history, messenger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const wait = dependencies.wait ?? sleep;
  const live = !forceDryRun && !config.dryRun && config.liveSendingEnabled && config.ui.verified;
  const result: RunResult = { sent: 0, dryRun: 0, skipped: 0, failed: 0, halted: false };
  let consecutiveFailures = 0;
  let attempted = false;
  for (const recipient of config.recipients.filter((item) => item.approved)) {
    dependencies.assertSafe?.();
    if (attempted) await wait(config.minIntervalSeconds * 1000);
    const day = calendarDay(now(), config.timezone);
    if (history.blocked(recipient.username, day)) {
      result.skipped++;
      continue;
    }
    attempted = true;
    const message = renderMessage(config, recipient, day);
    let session: Messenger | undefined;
    let reserved = false;
    try {
      await retryNavigation(async () => {
        dependencies.assertSafe?.();
        await session?.close().catch(() => undefined);
        session = undefined;
        session = await messenger();
        await session.prepare(recipient);
      }, wait);
      if (!session) throw new AppError('UI_CHANGED');
      if (!live) {
        history.event(recipient.username, day, message, 'dry-run', now());
        result.dryRun++;
      } else {
        if (calendarDay(now(), config.timezone) !== day) throw new AppError('DAY_CHANGED');
        reserved = history.reserve(recipient.username, day, message, now());
        if (!reserved) {
          result.skipped++;
          continue;
        }
        await (session as Messenger).submit(message, () => {
          dependencies.assertSafe?.();
          const clickTime = now();
          // Keep the entire bounded click operation away from the day boundary.
          if (
            calendarDay(clickTime, config.timezone) !== day ||
            calendarDay(new Date(clickTime.getTime() + 15_000), config.timezone) !== day
          )
            throw new AppError('DAY_CHANGED');
        });
        history.finish(recipient.username, day, 'sent', now());
        result.sent++;
      }
      consecutiveFailures = 0;
    } catch (error) {
      if (reserved) history.finish(recipient.username, day, 'uncertain', now());
      else history.event(recipient.username, day, message, 'failed', now(), errorCode(error));
      result.failed++;
      consecutiveFailures++;
      logger.error(
        { code: errorCode(error), recipientIndex: config.recipients.indexOf(recipient), reserved },
        'Recipient processing stopped',
      );
      if (reserved || fatalForRun(error) || consecutiveFailures >= config.maxConsecutiveFailures) {
        result.halted = true;
        break;
      }
    } finally {
      await session?.close().catch(() => undefined);
    }
  }
  logger.info({ ...result, mode: live ? 'live' : 'dry-run' }, 'Run complete');
  return result;
}
