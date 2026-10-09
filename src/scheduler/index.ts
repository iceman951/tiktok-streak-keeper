import cron from 'node-cron';
import type { Config } from '../config/index.js';
import { logger } from '../logger/index.js';
import type { RunResult } from '../tiktok/runner.js';
import { errorCode } from '../utils/errors.js';
import { dailyCron } from '../utils/time.js';

export function schedulerOptions(config: Pick<Config, 'timezone'>) {
  return { timezone: config.timezone, noOverlap: true } as const;
}

export class FailureCircuit {
  private failures = 0;
  constructor(private readonly limit: number) {}
  record(failed: boolean): boolean {
    this.failures = failed ? this.failures + 1 : 0;
    return this.failures >= this.limit;
  }
}

export async function startScheduler(
  config: Config,
  run: () => Promise<RunResult>,
  signal: AbortSignal,
): Promise<void> {
  const circuit = new FailureCircuit(config.maxConsecutiveFailures);
  let active: Promise<void> | undefined;
  let stopped = false;
  let resolveStopped: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const task = cron.createTask(
    dailyCron(config.schedule),
    () => {
      if (stopped) return;
      active = (async () => {
        try {
          const result = await run();
          if (result.halted || circuit.record(result.failed > 0)) {
            process.exitCode = 1;
            logger.error(
              'Scheduler stopped; inspect status and resolve failures before restarting',
            );
            stop();
          }
        } catch (error) {
          logger.error({ code: errorCode(error) }, 'Scheduled run failed');
          if (circuit.record(true)) {
            process.exitCode = 1;
            stop();
          }
        }
      })();
      return active;
    },
    schedulerOptions(config),
  );
  function stop() {
    stopped = true;
    void task.stop();
    resolveStopped();
  }
  signal.addEventListener('abort', stop, { once: true });
  try {
    if (signal.aborted) stop();
    else {
      await task.start();
      logger.info(
        { schedule: config.schedule, timezone: config.timezone, dryRun: config.dryRun },
        'Scheduler started; no catch-up or immediate run',
      );
    }
    await done;
    await active;
  } finally {
    signal.removeEventListener('abort', stop);
    await task.destroy();
  }
}
