import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TikTokMessenger } from '../src/tiktok/adapter.js';
import { config } from './helpers.js';

const fixture = `<!doctype html><html><body>
  <nav data-e2e="profile-icon">Signed in (fixture)</nav>
  <main data-e2e="chat-room">
    <header data-e2e="chat-header"><a href="/@friend.one">Display name</a></header>
    <section id="messages"></section>
    <div contenteditable="true" role="textbox"></div>
    <button data-e2e="message-send">Send</button>
  </main>
  <script>
    window.clicks = 0;
    document.querySelector('button').onclick = () => {
      window.clicks++;
      const composer = document.querySelector('[contenteditable]');
      const item = document.createElement('div');
      item.dataset.e2e = 'chat-item';
      item.dataset.direction = 'outgoing';
      const text = document.createElement('span');
      text.dataset.e2e = 'message-text';
      text.textContent = composer.textContent;
      item.append(text);
      document.querySelector('#messages').append(item);
      composer.textContent = '';
    };
  </script>
</body></html>`;

describe('browser adapter against a fully intercepted inbox fixture', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let adapter: TikTokMessenger;
  const options = config();
  const recipient = options.recipients[0]!;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  beforeEach(async () => {
    context = await browser.newContext({ serviceWorkers: 'block' });
    // Every request is fulfilled or aborted locally. No TikTok requests or user sessions.
    await context.route('**/*', async (route) => {
      if (route.request().resourceType() === 'document')
        await route.fulfill({ contentType: 'text/html', body: fixture });
      else await route.abort();
    });
    page = await context.newPage();
    adapter = new TikTokMessenger(page, options.ui, () => context.close());
  });
  afterEach(async () => {
    await context?.close();
  });

  it('preflights without modifying a draft or submitting', async () => {
    await adapter.prepare(recipient);
    expect(await page.locator('[contenteditable]').textContent()).toBe('');
    expect(await page.evaluate('window.clicks')).toBe(0);
  });
  it('submits once and requires a new outgoing message plus cleared composer', async () => {
    await adapter.prepare(recipient);
    let checked = false;
    await adapter.submit('Hi [friend] 👋', () => {
      checked = true;
    });
    expect(checked).toBe(true);
    expect(await page.evaluate('window.clicks')).toBe(1);
    expect(await page.locator('[data-e2e="message-text"]').textContent()).toBe('Hi [friend] 👋');
  });
  it('rechecks identity immediately before sending', async () => {
    await adapter.prepare(recipient);
    await page
      .locator('header a')
      .evaluate((element) => element.setAttribute('href', '/@someone.else'));
    await expect(adapter.submit('hi', () => undefined)).rejects.toMatchObject({
      code: 'IDENTITY_MISMATCH',
    });
    expect(await page.evaluate('window.clicks')).toBe(0);
  });
  it('stops for a CAPTCHA without clicking', async () => {
    await adapter.prepare(recipient);
    await page.evaluate(() => {
      const challenge = document.createElement('div');
      challenge.id = 'captcha';
      challenge.textContent = 'Verify';
      document.body.append(challenge);
    });
    await expect(adapter.submit('hi', () => undefined)).rejects.toMatchObject({
      code: 'SECURITY_CHALLENGE',
    });
    expect(await page.evaluate('window.clicks')).toBe(0);
  });
  it('rejects stale drafts and ambiguous composers', async () => {
    await adapter.prepare(recipient);
    await page.locator('[contenteditable]').fill('my existing draft');
    await expect(adapter.submit('hi', () => undefined)).rejects.toMatchObject({
      code: 'UI_CHANGED',
    });
    expect(await page.locator('[contenteditable]').textContent()).toBe('my existing draft');
    await page
      .locator('[contenteditable]')
      .evaluate((element) => element.after(element.cloneNode(true)));
    await expect(adapter.submit('hi', () => undefined)).rejects.toMatchObject({
      code: 'UI_CHANGED',
    });
    expect(await page.evaluate('window.clicks')).toBe(0);
  });
  it('rejects UI submission errors even when an outgoing bubble appears', async () => {
    await adapter.prepare(recipient);
    await page.locator('button').evaluate((button) =>
      button.addEventListener('click', () => {
        const failure = document.createElement('div');
        failure.dataset.e2e = 'message-send-error';
        failure.textContent = 'Failed';
        button.after(failure);
      }),
    );
    await expect(adapter.submit('hi', () => undefined)).rejects.toMatchObject({
      code: 'UI_CHANGED',
    });
    expect(await page.evaluate('window.clicks')).toBe(1);
  });
  it('does not click when the final safety check fails', async () => {
    await adapter.prepare(recipient);
    await expect(
      adapter.submit('hi', () => {
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await page.evaluate('window.clicks')).toBe(0);
  });

  it('does not accept composer clearing alone as submission evidence', async () => {
    adapter = new TikTokMessenger(page, options.ui, () => context.close(), 50);
    await adapter.prepare(recipient);
    await page.locator('button').evaluate((button) => {
      button.onclick = () => {
        const composer = document.querySelector('[contenteditable]');
        if (composer) composer.textContent = '';
      };
    });
    await expect(adapter.submit('hi', () => undefined)).rejects.toMatchObject({
      code: 'SEND_UNCERTAIN',
    });
  });
});
