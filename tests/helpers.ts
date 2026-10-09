import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative } from 'node:path';
import { configSchema, type Config } from '../src/config/index.js';

export function config(overrides: Partial<Config> = {}): Config {
  const example: unknown = JSON.parse(
    readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'),
  );
  const base = configSchema.parse(example);
  return configSchema.parse({
    ...base,
    recipients: [
      {
        username: 'friend.one',
        conversationUrl: 'https://www.tiktok.com/messages/thread-1',
        approved: true,
      },
    ],
    ...overrides,
  });
}

export function liveConfig(): Config {
  return config({
    dryRun: false,
    liveSendingEnabled: true,
    ui: { ...config().ui, verified: true },
  });
}

export function removeTemporaryDirectory(directory: string): void {
  const resolved = realpathSync(directory);
  const child = relative(realpathSync(tmpdir()), resolved);
  if (!child || child.startsWith('..') || isAbsolute(child))
    throw new Error('Unsafe temporary path');
  rmSync(resolved, { recursive: true, force: true });
}
