import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { withProfileLock } from '../src/browser/index.js';
import { removeTemporaryDirectory } from './helpers.js';

it('excludes simultaneous commands and releases the lock after an error', async () => {
  const root = realpathSync(tmpdir());
  const directory = mkdtempSync(join(root, 'streak-lock-'));
  try {
    await withProfileLock(directory, async (check) => {
      check();
      await expect(withProfileLock(directory, async () => undefined)).rejects.toMatchObject({
        code: 'LOCKED',
      });
    });
    await expect(
      withProfileLock(directory, async () => {
        throw new Error('fixture');
      }),
    ).rejects.toThrow('fixture');
    await expect(withProfileLock(directory, async () => 'released')).resolves.toBe('released');
  } finally {
    removeTemporaryDirectory(directory);
  }
});
