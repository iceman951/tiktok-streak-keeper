import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { History } from '../src/database/index.js';
import { removeTemporaryDirectory } from './helpers.js';

describe('durable duplicate prevention', () => {
  it('keeps pending reservations after restart and arbitrates two connections', () => {
    const dir = mkdtempSync(join(tmpdir(), 'streak-test-'));
    const path = join(dir, 'history.sqlite');
    const first = new History(path, 'Asia/Bangkok');
    const second = new History(path, 'Asia/Bangkok');
    const now = new Date('2026-10-09T13:00:00Z');
    try {
      expect(first.reserve('FRIEND', '2026-10-09', 'hi', now)).toBe(true);
      expect(second.reserve('friend', '2026-10-09', 'hi', now)).toBe(false);
    } finally {
      first.close();
      second.close();
    }
    const reopened = new History(path, 'Asia/Bangkok');
    try {
      expect(reopened.blocked('friend', '2026-10-09')).toBe(true);
      expect(reopened.recent()[0]?.status).toBe('pending');
      expect(reopened.reserve('friend', '2026-10-10', 'hi', now)).toBe(true);
      expect(() => new History(path, 'UTC')).toThrow('timezone');
    } finally {
      reopened.close();
      removeTemporaryDirectory(dir);
    }
  });
  it('dry-runs and preflight failures do not consume the daily reservation', () => {
    const db = new History(':memory:', 'Asia/Bangkok');
    try {
      db.event('friend', '2026-10-09', 'hi', 'dry-run', new Date());
      db.event('friend', '2026-10-09', 'hi', 'failed', new Date(), 'AUTH_REQUIRED');
      expect(db.blocked('friend', '2026-10-09')).toBe(false);
    } finally {
      db.close();
    }
  });
});
