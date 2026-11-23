// Live browser for Reddit checks: Playwright on the repo's signed-in Chrome Dev profile (.chrome-dev-profile/).
//
// No TCP debugging port and no connectOverCDP: Playwright launches Chrome itself and talks to it over its own
// --remote-debugging-pipe. The one CDP call is Extensions.loadUnpacked over that pipe, because branded Chrome 137+
// ignores --load-extension. Everything else (viewport, phone mode, clicks, evaluation, screenshots) is Playwright's API.
//
// CLI (run from the repo root):
//   node scripts/live/browser.mjs run <probe.mjs> [--url <url>] [--phone] [--no-load] [--headed-desktop]
//       <probe.mjs> default-exports async ({page, context, extensionId, args}) => result; the result is printed as JSON.
//   node scripts/live/browser.mjs open [--url <url>] [--phone] [--no-load] [--headed-desktop]
//       Keeps the browser open until Ctrl-C (for example to sign in again with --headed-desktop).
// Module: import {launch, reloadExtension} from './scripts/live/browser.mjs'.
//
// Rules (AGENTS.md, Live testing): read-only on Reddit, never get past "Prove your humanity" or 403 pages, space out
// page loads (about 40 loads in 30 minutes gets HTTP 429), and only one launch at a time (the profile is locked).
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROFILE = path.join(ROOT, '.chrome-dev-profile');
export const BUILD = path.join(ROOT, 'artifacts', 'reddit-chat-search');
export const CHROME = process.env.RT_CHROME || '/usr/bin/google-chrome-unstable';
export const DISPLAY = process.env.RT_DISPLAY || ':97';
export const PHONE = {
  viewport: {width: 412, height: 915}, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
  // Reddit serves phone markup by user agent (for example Open App in place of Log In).
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/160.0.0.0 Mobile Safari/537.36',
};
export const DESKTOP = {viewport: {width: 1440, height: 900}};

function playwright() {
  const require = createRequire(import.meta.url);
  for (const id of ['playwright-core', path.join(os.homedir(), '.npm-global/lib/node_modules/playwright-core')]) {
    try { return require(id); } catch {}
  }
  throw Error('playwright-core not found (npm i -g playwright-core).');
}

// Headed on a private X display: on the Wayland desktop the window stopped producing frames, and headless Chrome
// gets Reddit's bot check.
function ensureDisplay(display) {
  const n = display.replace(/^:/, '');
  if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) return;
  if (spawnSync('which', ['Xvfb']).status !== 0) throw Error('Xvfb is not installed; pass --headed-desktop.');
  spawn('Xvfb', [display, '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], {detached: true, stdio: 'ignore'}).unref();
  for (let i = 0; i < 40 && !fs.existsSync(`/tmp/.X11-unix/X${n}`); i++) spawnSync('sleep', ['0.1']);
}

export async function launch({phone = false, load = true, headedDesktop = false} = {}) {
  if (load && !fs.existsSync(path.join(BUILD, 'manifest.json'))) throw Error('Run npm run package first.');
  const env = {...process.env};
  if (!headedDesktop) {
    ensureDisplay(DISPLAY);
    Object.assign(env, {DISPLAY, WAYLAND_DISPLAY: '', XDG_SESSION_TYPE: 'x11'});
  }
  const context = await playwright().chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: false,
    // Keep extensions, and keep the OS keyring: Playwright's --password-store=basic / --use-mock-keychain cannot read
    // the profile's encrypted cookies, so Reddit would see a signed-out browser and replace the session cookies.
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions', '--disable-component-extensions-with-background-pages',
      '--password-store=basic', '--use-mock-keychain', '--disable-sync', '--disable-background-networking'],
    args: ['--enable-unsafe-extension-debugging', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', ...(headedDesktop ? [] : ['--ozone-platform=x11'])],
    env,
    ...(phone ? PHONE : DESKTOP),
  });
  let extensionId = null;
  if (load) {
    const session = await context.browser().newBrowserCDPSession();
    extensionId = (await session.send('Extensions.loadUnpacked', {path: BUILD})).id;
    await session.detach().catch(() => {});
    // The worker needs a moment before chrome-extension:// pages open.
    for (let i = 0; i < 30 && !context.serviceWorkers().some(w => w.url().startsWith(`chrome-extension://${extensionId}/`)); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return {context, extensionId, page: context.pages()[0] || await context.newPage()};
}

// After npm run package during a session: reload from disk through the extension's own page.
export async function reloadExtension(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const version = await page.evaluate(() => chrome.runtime.getManifest().version);
  await page.evaluate(() => setTimeout(() => chrome.runtime.reload(), 50));
  await page.waitForTimeout(1500);
  await page.close().catch(() => {});
  return version;
}

function parse(argv) {
  const out = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2), next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = parse(process.argv.slice(2));
  const [command, probe] = args._;
  if (!['run', 'open'].includes(command) || (command === 'run' && !probe)) {
    console.error('Usage: node scripts/live/browser.mjs run <probe.mjs> [--url U] [--phone] [--no-load] [--headed-desktop]\n' +
      '       node scripts/live/browser.mjs open [--url U] [--phone] [--no-load] [--headed-desktop]');
    process.exit(2);
  }
  const {context, page, extensionId} = await launch({phone: Boolean(args.phone), load: !args['no-load'], headedDesktop: Boolean(args['headed-desktop'])});
  const close = async code => { await context.close().catch(() => {}); process.exit(code); };
  process.on('SIGINT', () => close(0));
  try {
    if (args.url) await page.goto(args.url, {waitUntil: 'domcontentloaded'});
    if (command === 'open') {
      console.log(`open${extensionId ? ' with ' + extensionId : ''}; Ctrl-C to close`);
      await new Promise(resolve => context.on('close', resolve));
      process.exit(0);
    }
    const mod = await import(pathToFileURL(path.resolve(probe)).href);
    const result = await mod.default({page, context, extensionId, args});
    if (result !== undefined) console.log(JSON.stringify(result, null, 1));
    await close(0);
  } catch (error) {
    console.error(error?.stack || String(error));
    await close(1);
  }
}
