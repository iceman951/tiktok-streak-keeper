import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { Config } from '../config/index.js';
import { launchBrowser } from '../browser/index.js';
import { assertAuthenticated } from '../tiktok/adapter.js';

export async function login(config: Config, dataDir: string): Promise<void> {
  if (!stdin.isTTY) throw new Error('Manual login requires an interactive terminal');
  const browser = await launchBrowser(dataDir, false);
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto('https://www.tiktok.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await prompt.question('Log in manually, open your TikTok inbox, then press Enter here. ');
    await assertAuthenticated(page, config.ui);
    stdout.write('Authenticated session saved locally.\n');
  } finally {
    prompt.close();
    await browser.close();
  }
}
