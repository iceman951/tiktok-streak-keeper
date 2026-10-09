import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { chromium, type BrowserContext } from 'playwright';
import { AppError } from '../utils/errors.js';

export async function withProfileLock<T>(
  dataDir: string,
  action: (checkLock: () => void) => Promise<T>,
): Promise<T> {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let compromised = false;
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(dataDir, {
      lockfilePath: join(dataDir, 'automation.lock'),
      stale: 120_000,
      update: 10_000,
      retries: 0,
      onCompromised: () => {
        compromised = true;
      },
    });
  } catch {
    throw new AppError('LOCKED');
  }
  try {
    const result = await action(() => {
      if (compromised) throw new AppError('LOCKED');
    });
    if (compromised) throw new AppError('LOCKED');
    return result;
  } finally {
    await release().catch(() => undefined);
  }
}

export async function launchBrowser(dataDir: string, headless: boolean): Promise<BrowserContext> {
  return chromium.launchPersistentContext(join(dataDir, 'browser-profile'), {
    headless,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
    timeout: 30_000,
  });
}
