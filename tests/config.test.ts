import { describe, expect, it } from 'vitest';
import { configSchema, isConversationUrl } from '../src/config/index.js';
import { config } from './helpers.js';

describe('safe configuration', () => {
  it('defaults to dry-run, Bangkok and 20:00', () => {
    const value = configSchema.parse({ ui: config().ui });
    expect(value).toMatchObject({
      dryRun: true,
      liveSendingEnabled: false,
      timezone: 'Asia/Bangkok',
      schedule: '20:00',
      recipients: [],
    });
  });
  it('requires both live opt-ins and verified selectors', () => {
    expect(() => config({ dryRun: false })).toThrow();
    expect(() => config({ dryRun: false, liveSendingEnabled: true })).toThrow();
  });
  it.each([
    'https://evil.test/messages/1',
    'https://www.tiktok.com/messages',
    'https://www.tiktok.com/messages?lang=en',
    'https://www.tiktok.com/@friend',
    'http://www.tiktok.com/messages/1',
    'https://user:pass@www.tiktok.com/messages/1',
    'not a url',
  ])('rejects unsafe or nonspecific URL %s', (url) => {
    expect(isConversationUrl(url)).toBe(false);
    expect(
      configSchema.safeParse({
        ...config(),
        recipients: [{ username: 'friend', conversationUrl: url }],
      }).success,
    ).toBe(false);
  });
  it('rejects duplicate recipients even with a different username case', () => {
    const recipient = config().recipients[0]!;
    expect(() =>
      config({ recipients: [recipient, { ...recipient, username: 'FRIEND.ONE' }] }),
    ).toThrow();
  });
  it('rejects invalid times, zones, and templates', () => {
    expect(() => config({ schedule: '24:00' })).toThrow();
    expect(() => config({ timezone: 'Bad/Zone' })).toThrow();
    expect(() => config({ messageTemplates: ['{password}'] })).toThrow();
    expect(() => config({ messageTemplates: ['Hi\nthere'] })).toThrow();
  });
});
