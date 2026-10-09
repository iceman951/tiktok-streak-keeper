import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export function isConversationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://www.tiktok.com' &&
      !url.username &&
      !url.password &&
      /^\/messages(?:\/|$)/u.test(url.pathname) &&
      (url.pathname.replace(/\/$/u, '') !== '/messages' ||
        [...url.searchParams.keys()].some((key) => !['lang', 'from'].includes(key)))
    );
  } catch {
    return false;
  }
}

const selector = z.string().trim().min(1).max(500);
export const recipientSchema = z
  .object({
    username: z.string().regex(/^[A-Za-z0-9_.]{2,24}$/u),
    conversationUrl: z.string().refine(isConversationUrl, 'Use a specific TikTok messages URL'),
    approved: z.boolean().default(false),
    messageTemplate: z.string().min(1).max(300).optional(),
  })
  .strict();

export const configSchema = z
  .object({
    dryRun: z.boolean().default(true),
    liveSendingEnabled: z.boolean().default(false),
    timezone: z
      .string()
      .default('Asia/Bangkok')
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone'),
    schedule: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
      .default('20:00'),
    headless: z.boolean().default(false),
    messageTemplates: z
      .array(z.string().min(1).max(300))
      .min(1)
      .max(20)
      .default(['Hi {username}! 👋']),
    minIntervalSeconds: z.number().int().min(30).max(3600).default(60),
    maxConsecutiveFailures: z.number().int().min(1).max(5).default(3),
    recipients: z.array(recipientSchema).max(20).default([]),
    ui: z
      .object({
        verified: z.boolean().default(false),
        authenticated: selector,
        loginRequired: selector,
        securityChallenge: selector,
        conversationLinks: selector,
        conversationRoot: selector,
        recipientProfileLink: selector,
        composer: selector,
        sendButton: selector,
        outgoingMessages: selector,
        sendFailure: selector,
      })
      .strict(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const users = config.recipients.map((r) => r.username.toLowerCase());
    const urls = config.recipients
      .map((r) => r.conversationUrl)
      .filter(isConversationUrl)
      .map((url) => new URL(url).href);
    if (new Set(users).size !== users.length || new Set(urls).size !== urls.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate username or conversation URL' });
    }
    if (!config.dryRun && (!config.liveSendingEnabled || !config.ui.verified)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Live mode requires liveSendingEnabled and ui.verified',
      });
    }
    for (const template of [
      ...config.messageTemplates,
      ...config.recipients.flatMap((r) => (r.messageTemplate ? [r.messageTemplate] : [])),
    ]) {
      if (
        !template.trim() ||
        [...template].some((character) => character.charCodeAt(0) < 32) ||
        /[{}]/u.test(template.replaceAll('{username}', '').replaceAll('{date}', ''))
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Templates must be one line and use only {username} or {date}',
        });
      }
    }
  });

export type Config = z.infer<typeof configSchema>;
export type Recipient = z.infer<typeof recipientSchema>;

export function loadConfig(): Config {
  return configSchema.parse(
    JSON.parse(readFileSync(resolve(process.env.CONFIG_PATH ?? 'config.json'), 'utf8')),
  );
}

export function dataDirectory(): string {
  return resolve(process.env.DATA_DIR ?? 'data');
}
