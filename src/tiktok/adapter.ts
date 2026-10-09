import type { BrowserContext, Locator, Page } from 'playwright';
import { launchBrowser } from '../browser/index.js';
import type { Config, Recipient } from '../config/index.js';
import { isConversationUrl } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { sleep } from '../utils/time.js';

export interface Messenger {
  prepare(recipient: Recipient): Promise<void>;
  submit(message: string, beforeClick: () => void): Promise<void>;
  close(): Promise<void>;
}

async function anyVisible(locator: Locator): Promise<boolean> {
  for (const match of await locator.all()) if (await match.isVisible()) return true;
  return false;
}

export async function assertAuthenticated(page: Page, ui: Config['ui']): Promise<void> {
  if (page.isClosed()) throw new AppError('TRANSIENT_NAVIGATION');
  const url = new URL(page.url());
  if (url.origin !== 'https://www.tiktok.com') throw new AppError('AUTH_REQUIRED');
  if (await anyVisible(page.locator(ui.securityChallenge)))
    throw new AppError('SECURITY_CHALLENGE');
  if (/\/login(?:\/|$)/u.test(url.pathname) || (await anyVisible(page.locator(ui.loginRequired)))) {
    throw new AppError('AUTH_REQUIRED');
  }
  if (!(await anyVisible(page.locator(ui.authenticated)))) throw new AppError('AUTH_REQUIRED');
}

async function uniqueVisible(locator: Locator): Promise<Locator> {
  if ((await locator.count()) !== 1 || !(await locator.isVisible()))
    throw new AppError('UI_CHANGED');
  return locator;
}

async function composerText(composer: Locator): Promise<string> {
  return composer.evaluate((element) =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : (element.textContent ?? ''),
  );
}

export class TikTokMessenger implements Messenger {
  private recipient: Recipient | undefined;
  constructor(
    private readonly page: Page,
    private readonly ui: Config['ui'],
    private readonly cleanup: () => Promise<void>,
    private readonly evidenceTimeoutMs = 15_000,
  ) {
    page.setDefaultTimeout(10_000);
  }

  private root(): Locator {
    return this.page.locator(this.ui.conversationRoot);
  }

  private async guard(): Promise<void> {
    await assertAuthenticated(this.page, this.ui);
    if (!this.recipient) throw new AppError('UI_CHANGED');
    const root = await uniqueVisible(this.root());
    const link = await uniqueVisible(root.locator(this.ui.recipientProfileLink));
    const href = await link.getAttribute('href');
    const url = new URL(href ?? '', this.page.url());
    if (
      url.origin !== 'https://www.tiktok.com' ||
      decodeURIComponent(url.pathname).replace(/\/$/u, '').toLowerCase() !==
        `/@${this.recipient.username.toLowerCase()}`
    ) {
      throw new AppError('IDENTITY_MISMATCH');
    }
    if (await anyVisible(root.locator(this.ui.sendFailure))) throw new AppError('UI_CHANGED');
  }

  async prepare(recipient: Recipient): Promise<void> {
    if (!recipient.approved || !isConversationUrl(recipient.conversationUrl))
      throw new AppError('IDENTITY_MISMATCH');
    this.recipient = recipient;
    try {
      const response = await this.page.goto(recipient.conversationUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      if (response?.status() === 429 || response?.status() === 403)
        throw new AppError('SECURITY_CHALLENGE');
      if (response && response.status() >= 500) throw new AppError('TRANSIENT_NAVIGATION');
      if (response && response.status() >= 400) throw new AppError('UI_CHANGED');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('TRANSIENT_NAVIGATION');
    }
    // Give the SPA a bounded opportunity to render; never guess a fallback target.
    await this.root()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => undefined);
    await this.guard();
    const composer = await uniqueVisible(this.root().locator(this.ui.composer));
    if (!(await composer.isEditable()) || (await composerText(composer)).trim())
      throw new AppError('UI_CHANGED');
    await uniqueVisible(this.root().locator(this.ui.sendButton));
  }

  async submit(message: string, beforeClick: () => void): Promise<void> {
    await this.guard();
    const root = this.root();
    const composer = await uniqueVisible(root.locator(this.ui.composer));
    if ((await composerText(composer)).trim()) throw new AppError('UI_CHANGED');
    const escaped = message.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const matching = root
      .locator(this.ui.outgoingMessages)
      .filter({ hasText: new RegExp(`^${escaped}$`, 'u') });
    const before = await matching.count();
    await composer.fill(message);
    if ((await composerText(composer)) !== message) throw new AppError('UI_CHANGED');
    await this.guard();
    const button = await uniqueVisible(root.locator(this.ui.sendButton));
    if (!(await button.isEnabled())) throw new AppError('UI_CHANGED');
    beforeClick();
    // Exactly one click attempt. Any exception from this point is ambiguous.
    await button.click({ timeout: 10_000 });
    const deadline = Date.now() + this.evidenceTimeoutMs;
    while (Date.now() < deadline) {
      await this.guard();
      if ((await matching.count()) === before + 1 && !(await composerText(composer)).trim()) {
        await sleep(1000);
        await this.guard();
        if ((await matching.count()) === before + 1 && !(await composerText(composer)).trim())
          return;
      }
      await sleep(250);
    }
    throw new AppError('SEND_UNCERTAIN');
  }

  async close(): Promise<void> {
    await this.cleanup();
  }
}

export async function createMessenger(config: Config, dataDir: string): Promise<Messenger> {
  let browser: BrowserContext | undefined;
  try {
    browser = await launchBrowser(dataDir, config.headless);
    const context = browser;
    const page = context.pages()[0] ?? (await context.newPage());
    return new TikTokMessenger(page, config.ui, () => context.close());
  } catch {
    await browser?.close().catch(() => undefined);
    throw new AppError('TRANSIENT_NAVIGATION');
  }
}

export interface ChatCandidate {
  label: string;
  conversationUrl: string;
}

export async function inspectChats(config: Config, dataDir: string): Promise<ChatCandidate[]> {
  const browser = await launchBrowser(dataDir, false);
  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto('https://www.tiktok.com/messages', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page
      .locator(config.ui.conversationLinks)
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => undefined);
    await assertAuthenticated(page, config.ui);
    const links = await page.locator(config.ui.conversationLinks).evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.textContent?.trim().slice(0, 100) ?? '',
        conversationUrl: node instanceof HTMLAnchorElement ? node.href : '',
      })),
    );
    return [
      ...new Map(
        links
          .filter((link) => isConversationUrl(link.conversationUrl))
          .map((link) => [link.conversationUrl, link]),
      ).values(),
    ];
  } finally {
    await browser.close();
  }
}
