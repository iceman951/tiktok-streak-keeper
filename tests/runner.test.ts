import { afterEach, describe, expect, it, vi } from 'vitest';
import { History } from '../src/database/index.js';
import { AppError } from '../src/utils/errors.js';
import { runMessages } from '../src/tiktok/runner.js';
import { config, liveConfig } from './helpers.js';
import type { Recipient } from '../src/config/index.js';

const databases: History[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup() {
  const history = new History(':memory:', 'Asia/Bangkok');
  databases.push(history);
  const session = {
    prepare: vi.fn<(recipient: Recipient) => Promise<void>>(async () => undefined),
    submit: vi.fn(async (_message: string, beforeClick: () => void) => {
      beforeClick();
    }),
    close: vi.fn(async () => undefined),
  };
  return {
    history,
    session,
    dependencies: {
      history,
      messenger: vi.fn(async () => session),
      now: () => new Date('2026-10-09T13:00:00Z'),
      wait: vi.fn<(ms: number) => Promise<void>>(async () => undefined),
    },
  };
}

describe('send pipeline with mocked submissions', () => {
  it('dry-runs do not fill or submit and do not block a later live send', async () => {
    const { history, session, dependencies } = setup();
    expect((await runMessages(liveConfig(), true, dependencies)).dryRun).toBe(1);
    expect(session.submit).not.toHaveBeenCalled();
    expect(history.blocked('friend.one', '2026-10-09')).toBe(false);
    expect((await runMessages(liveConfig(), false, dependencies)).sent).toBe(1);
  });
  it('default mode is dry-run even through the send command', async () => {
    const { session, dependencies } = setup();
    expect((await runMessages(config(), false, dependencies)).dryRun).toBe(1);
    expect(session.submit).not.toHaveBeenCalled();
  });
  it('reserves before submission and never sends twice in a day', async () => {
    const { session, dependencies, history } = setup();
    session.submit.mockImplementation(async () => {
      expect(history.recent()[0]?.status).toBe('pending');
    });
    expect((await runMessages(liveConfig(), false, dependencies)).sent).toBe(1);
    expect((await runMessages(liveConfig(), false, dependencies)).skipped).toBe(1);
    expect(session.submit).toHaveBeenCalledTimes(1);
    expect(history.recent()[0]?.status).toBe('sent');
  });
  it('never retries an ambiguous send and blocks it on restart', async () => {
    const { session, dependencies, history } = setup();
    session.submit.mockRejectedValue(new Error('browser crashed after click'));
    expect(await runMessages(liveConfig(), false, dependencies)).toMatchObject({
      failed: 1,
      halted: true,
    });
    expect((await runMessages(liveConfig(), false, dependencies)).skipped).toBe(1);
    expect(session.submit).toHaveBeenCalledTimes(1);
    expect(history.recent()[0]?.status).toBe('uncertain');
  });
  it('restarts the browser only for bounded transient preflight retries', async () => {
    const { session, dependencies } = setup();
    session.prepare.mockRejectedValue(new AppError('TRANSIENT_NAVIGATION'));
    expect((await runMessages(liveConfig(), false, dependencies)).failed).toBe(1);
    expect(dependencies.messenger).toHaveBeenCalledTimes(3);
    expect(dependencies.wait.mock.calls).toEqual([[1000], [2000]]);
    expect(session.submit).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(3);
  });
  it('stops immediately on failed identity checks without consuming a reservation', async () => {
    const { session, dependencies, history } = setup();
    session.prepare.mockRejectedValue(new AppError('IDENTITY_MISMATCH'));
    const options = liveConfig();
    options.recipients.push({
      username: 'another',
      conversationUrl: 'https://www.tiktok.com/messages/2',
      approved: true,
    });
    expect((await runMessages(options, false, dependencies)).halted).toBe(true);
    expect(session.prepare).toHaveBeenCalledTimes(1);
    expect(history.blocked('friend.one', '2026-10-09')).toBe(false);
  });
  it('ignores unapproved recipients and spaces approved submissions', async () => {
    const { dependencies, session } = setup();
    const options = liveConfig();
    options.recipients.push(
      {
        username: 'ignored',
        conversationUrl: 'https://www.tiktok.com/messages/2',
        approved: false,
      },
      {
        username: 'approved',
        conversationUrl: 'https://www.tiktok.com/messages/3',
        approved: true,
      },
    );
    expect((await runMessages(options, false, dependencies)).sent).toBe(2);
    expect(session.prepare.mock.calls.map(([recipient]) => recipient)).toHaveLength(2);
    expect(dependencies.wait).toHaveBeenCalledWith(60_000);
  });
  it('does not click when preparation crosses midnight', async () => {
    const { dependencies, session, history } = setup();
    let now = new Date('2026-10-09T16:59:59Z');
    dependencies.now = () => now;
    session.prepare.mockImplementation(async () => {
      now = new Date('2026-10-09T17:00:01Z');
    });
    expect((await runMessages(liveConfig(), false, dependencies)).failed).toBe(1);
    expect(session.submit).not.toHaveBeenCalled();
    expect(history.blocked('friend.one', '2026-10-09')).toBe(false);
  });

  it('blocks a reserved attempt too close to midnight for a bounded click', async () => {
    const { dependencies, session, history } = setup();
    dependencies.now = () => new Date('2026-10-09T16:59:50Z');
    expect((await runMessages(liveConfig(), false, dependencies)).halted).toBe(true);
    expect(session.submit).toHaveBeenCalledTimes(1);
    expect(history.recent()[0]?.status).toBe('uncertain');
  });

  it('stops a batch after repeated exhausted navigation failures', async () => {
    const { dependencies, session } = setup();
    const options = liveConfig();
    options.recipients = Array.from({ length: 4 }, (_, i) => ({
      username: `friend.${i}`,
      conversationUrl: `https://www.tiktok.com/messages/${i}`,
      approved: true,
    }));
    session.prepare.mockRejectedValue(new AppError('TRANSIENT_NAVIGATION'));
    expect(await runMessages(options, false, dependencies)).toMatchObject({
      failed: 3,
      halted: true,
    });
    expect(session.prepare).toHaveBeenCalledTimes(9);
    expect(session.submit).not.toHaveBeenCalled();
  });
});
