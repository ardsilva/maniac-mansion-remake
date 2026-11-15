// Dev helper: drives the game in headless Chromium and saves screenshots.
// Usage: node tools/shot.mjs <outPrefix> <step> [<step> ...]
//   steps: wait:MS | click:X:Y (game coords 320x200) | key:NAME | shot:NAME | eval:JS
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const groot = execSync('npm root -g').toString().trim();
const { chromium } = require(path.join(groot, '@playwright/cli/node_modules/playwright-core'));
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const dir = fs.readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().pop();
const exe = path.join(cache, dir, 'chrome-linux64/chrome');

const [prefix, ...steps] = process.argv.slice(2);
const url = process.env.GAME_URL || 'http://127.0.0.1:8765/index.html?disk=research/disk/mm.st';
const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => console.log('console:', m.text()));
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
for (const s of steps) {
  const [cmd, ...a] = s.split(':');
  if (cmd === 'wait') await page.waitForTimeout(+a[0]);
  else if (cmd === 'click') await page.mouse.click(+a[0] * 4 + 2, +a[1] * 4 + 2);
  else if (cmd === 'move') await page.mouse.move(+a[0] * 4 + 2, +a[1] * 4 + 2);
  else if (cmd === 'key') await page.keyboard.press(a[0]);
  else if (cmd === 'shot') await page.screenshot({ path: `${prefix}-${a[0]}.png` });
  else if (cmd === 'eval') console.log('eval:', JSON.stringify(await page.evaluate(a.join(':'))));
}
await browser.close();
