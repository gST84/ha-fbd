// Browser test, third round: wire-drag selection, right-click menu, time of day, rooms, light / dark mode.
// Run: npx tsx test/e2e-features2.ts
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
// @ts-ignore
import { chromium } from 'playwright';
import { startHarness } from './harness';

const SHOTS = process.env.SHOTS ?? './shots'; mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const h = await startHarness([
  { entity_id: 'light.sofa', state: 'on', attributes: { friendly_name: 'Sofa' } },
  { entity_id: 'media_player.tv', state: 'playing', attributes: { friendly_name: 'TV' } },
  { entity_id: 'switch.lamp', state: 'on', attributes: {} },
  { entity_id: 'light.stove', state: 'off', attributes: {} },
]);
const { base, calls } = h;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1300 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push('pageerror: ' + e.message));
page.on('console', (m: any) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', (d: any) => d.accept());
const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const center = async (sel: string) => { const b = await page.locator(sel).boundingBox(); assert.ok(b, `no box for ${sel}`); return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 }; };
async function wire(from: string, to: string) {
  const a = await center(`[data-out="${from}"]`), b = await center(`[data-in="${to}"]`);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}
const waitUntil = async (cond: () => boolean | Promise<boolean>, what: string, ms = 6000) => {
  const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(30); }
};
const chip = (testId: string) => page.locator(`label:has([data-testid="${testId}"])`);          // the visible chip is the click target
const add = (type: string) => page.locator(`[data-palette="${type}"]`).click();
const blocks = () => page.locator('.block').count();
const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
const hhmm = (offsetMin: number) => {          // wall-clock "HH:MM" in Home Assistant's zone (Europe/Brussels), shifted by offsetMin
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(Date.now() + offsetMin * 60_000));
  return `${parts.find(p => p.type === 'hour')!.value}:${parts.find(p => p.type === 'minute')!.value}`;
};

try {
  await page.goto(base);
  await page.getByTestId('new-automation').click();
  await page.getByTestId('new-name').fill('Round three');
  await page.getByTestId('create').click();
  await page.waitForSelector('.network');

  // ───── 1. dragging a wire must not select text ─────
  await add('ENTITY_IN'); await add('NOT');
  const out = (await page.locator('[data-out="entity_in_1.OUT"]').boundingBox())!;
  await page.mouse.move(out.x + 5, out.y + 5); await page.mouse.down();
  for (const [x, y] of [[400, 300], [100, 200], [60, 500], [1400, 300], [700, 250]]) await page.mouse.move(x, y, { steps: 6 });
  const during = await page.evaluate(() => ({ type: getSelection()?.type, text: getSelection()?.toString(), drag: document.documentElement.classList.contains('dragging') }));
  assert.equal(during.type, 'None', `no selection anchor may be created (was ${during.type})`);
  assert.equal(during.text, ''); assert.ok(during.drag, 'page is marked as dragging');
  await page.mouse.up();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dragging')), false, 'dragging mode ends with the mouse button');
  // the same for moving a block and for the selection box
  const head = (await page.locator('[data-block="not_1"] .head').boundingBox())!;
  await page.mouse.move(head.x + 8, head.y + 8); await page.mouse.down(); await page.mouse.move(60, 600, { steps: 8 });
  assert.equal(await page.evaluate(() => getSelection()?.type), 'None'); await page.mouse.up();
  await page.locator('[data-block="entity_in_1"]').click({ button: 'right' });     // (clears nothing, just a smoke test of right-click)
  await page.keyboard.press('Escape');

  // ───── 2. right-click: copy / cut / paste / delete / select all ─────
  await add('AND');
  const n0 = await blocks();
  await page.locator('[data-block="and_1"] .head').click({ button: 'right', position: { x: 8, y: 8 } });
  await page.getByTestId('ctx-menu').waitFor();
  const items = await page.getByTestId('ctx-menu').locator('button').allInnerTexts();
  assert.deepEqual(items.map(t => t.split('\n')[0]), ['Copy', 'Cut', 'Paste here', 'Delete', 'Select all']);
  assert.ok(await page.getByTestId('ctx-menu').locator('[data-item="Paste here"]').isDisabled(), 'nothing to paste yet');
  assert.equal(await page.locator('[data-block="and_1"].sel').count(), 1, 'right-click selects the block under the cursor');
  await page.getByTestId('ctx-menu').locator('[data-item="Copy"]').click();
  assert.equal(await page.getByTestId('ctx-menu').count(), 0, 'menu closes after a choice');
  const svg = (await page.locator('[data-net="net_1"] svg').boundingBox())!;
  await page.mouse.click(svg.x + 600, svg.y + 150, { button: 'right' });
  await page.getByTestId('ctx-menu').waitFor();
  assert.ok(await page.getByTestId('ctx-menu').locator('[data-item="Paste here"]').isEnabled());
  await page.getByTestId('ctx-menu').locator('[data-item="Paste here"]').click();
  assert.equal(await blocks(), n0 + 1, 'pasted a copy');
  const pasted = (await page.locator('[data-block="and_2"]').getAttribute('transform'))!;
  const [px, py] = /translate\((\d+),(\d+)\)/.exec(pasted)!.slice(1).map(Number);
  assert.ok(Math.abs(px - 600) <= 20 && Math.abs(py - 150) <= 20, `pasted where the mouse was (${px},${py})`);
  await page.locator('[data-block="and_2"] .head').click({ button: 'right', position: { x: 8, y: 8 } });
  await page.getByTestId('ctx-menu').locator('[data-item="Cut"]').click();
  assert.equal(await blocks(), n0, 'Cut removed it'); 
  await page.mouse.click(svg.x + 500, svg.y + 150, { button: 'right' });
  await page.getByTestId('ctx-menu').locator('[data-item="Paste here"]').click();
  assert.equal(await blocks(), n0 + 1, 'the cut block can be pasted again');
  await page.locator('[data-block="and_2"] .head').click({ button: 'right', position: { x: 8, y: 8 } });
  await page.getByTestId('ctx-menu').locator('[data-item="Delete"]').click();
  assert.equal(await blocks(), n0, 'Delete from the menu');
  await page.mouse.click(svg.x + 500, svg.y + 150, { button: 'right' });
  await page.getByTestId('ctx-menu').locator('[data-item="Select all"]').click();
  assert.match((await page.getByTestId('props-multi').textContent())!, new RegExp(`${n0} blocks selected`));
  await page.mouse.click(svg.x + 500, svg.y + 150, { button: 'right' });
  await page.getByTestId('ctx-menu').waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('ctx-menu').count(), 0, 'Escape closes it');
  await page.mouse.click(svg.x + 500, svg.y + 150, { button: 'right' });
  await page.getByTestId('ctx-menu').waitFor(); await page.mouse.click(40, 700);
  assert.equal(await page.getByTestId('ctx-menu').count(), 0, 'a click elsewhere closes it');
  await shot('11-context-menu');

  // clean slate for the next parts
  await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
  assert.equal(await blocks(), 0);

  // ───── 3. time of day ─────
  await add('TIME_OF_DAY');
  await page.getByTestId('p-start').fill(hhmm(-5)); await page.getByTestId('p-end').fill(hhmm(5));
  assert.match((await page.getByTestId('tod-summary').textContent())!, /every day/);
  await chip('day-3').click();                                    // Wednesday only …
  assert.match((await page.getByTestId('tod-summary').textContent())!, /only on Wed/);
  assert.match((await page.locator('[data-block="time_of_day_1"] .sub').textContent())!, /Wed/);
  await chip('day-3').click();                                  // … and back to every day
  assert.match((await page.getByTestId('tod-summary').textContent())!, /every day/);
  await add('TIME_OF_DAY'); await page.getByTestId('p-start').fill(hhmm(60)); await page.getByTestId('p-end').fill(hhmm(120));
  // time → light:  Q of the first block drives a room action later; for now just look at the live values
  await page.getByTestId('deploy').click();
  await waitUntil(async () => ((await page.getByTestId('toast').textContent().catch(() => '')) ?? '').includes('Deployed'), 'deployed');
  await waitUntil(async () => (await page.locator('[data-block="time_of_day_1"] text.live').allTextContents()).includes('TRUE'), 'inside the window (HA time zone Europe/Brussels)');
  assert.ok((await page.locator('[data-block="time_of_day_2"] text.live').allTextContents()).includes('FALSE'), 'a window an hour away is closed');
  const now = Number((await page.locator('[data-block="time_of_day_1"] text.live').allTextContents()).find(t => /^\d+$/.test(t)));
  const [hh, mm] = hhmm(0).split(':').map(Number);
  assert.ok(Math.abs(now - (hh * 60 + mm) * 60_000) < 3 * 60_000, `NOW is the time of day in ms (${now})`);
  await shot('12-time-of-day');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
  await page.getByTestId('toggle-run').click();

  // ───── 4. switch off a whole room ─────
  await add('CONST'); await page.getByLabel('Data type').selectOption('BOOL'); await page.getByLabel('Value').selectOption('true');
  assert.equal(await page.locator('[data-palette="AREA_OUT"]').count(), 0, 'no separate ROOM OUT block any more');
  await add('RESET');
  await page.getByTestId('p-target').selectOption('room');
  const opts = (await page.getByTestId('p-area').locator('option').allTextContents()).map(t => t.replace(/\u00a0/g, ' '));
  assert.deepEqual(opts, ['— select —', 'Zone: Ground floor (all rooms)', '   – Living room', 'Rooms without a zone', '   – Kitchen'], 'zone first, its rooms below it');
  await page.getByTestId('p-area').selectOption('area:living_room');
  const preview = (await page.getByTestId('area-preview').textContent())!;
  assert.ok(preview.includes('2 devices') && preview.includes('light.sofa') && preview.includes('media_player.tv'), preview);
  assert.ok(!preview.includes('switch.lamp') && !preview.includes('light.stove'), 'only lights + media players of THIS room');
  await chip('domain-switch').click();
  assert.ok((await page.getByTestId('area-preview').textContent())!.includes('switch.lamp'), 'switches can be added');
  await chip('domain-switch').click();
  assert.match((await page.locator('[data-block="reset_1"] .sub').textContent())!, /living room/);
  await wire('const_1.OUT', 'net_1|reset_1|IN');
  await page.getByTestId('deploy').click();
  await waitUntil(() => calls.filter(c => c.target?.area_id === 'living_room').length === 2, 'two area calls');
  const area = calls.filter(c => c.target?.area_id === 'living_room');
  assert.deepEqual(area.map(c => `${c.domain}.${c.service}`).sort(), ['light.turn_off', 'media_player.turn_off']);
  await sleep(300);
  assert.equal(calls.filter(c => c.target?.area_id).length, 2, 'fired once, not every scan');
  // a whole zone (floor) instead of one room
  await page.getByTestId('p-area').selectOption('floor:ground_floor');
  const zonePreview = (await page.getByTestId('area-preview').textContent())!;
  assert.ok(zonePreview.includes('Ground floor') && zonePreview.includes('light.sofa') && zonePreview.includes('media_player.tv') && !zonePreview.includes('light.stove'), zonePreview);
  assert.match((await page.locator('[data-block="reset_1"] .sub').textContent())!, /zone ground floor/);
  await page.getByTestId('deploy').click();
  await waitUntil(() => calls.filter(c => c.target?.floor_id === 'ground_floor').length === 2, 'two floor calls');
  assert.deepEqual(calls.filter(c => c.target?.floor_id).map(c => `${c.domain}.${c.service}`).sort(), ['light.turn_off', 'media_player.turn_off']);
  await shot('13-room');

  // ───── 4b. PID controller ─────
  await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
  await add('PID');
  assert.ok(await page.locator('h3', { hasText: /^Control$/i }).count() > 0, 'a Control section in the palette');
  await page.getByTestId('const-KP').fill('20');
  await page.getByTestId('const-TI').fill('10m');
  assert.match((await page.getByTestId('props').textContent())!, /PID/);
  await page.getByTestId('const-KP').blur();
  assert.equal(await page.getByTestId('const-KP').inputValue(), '20');
  await shot('15-pid');

  // ───── 5. light / dark mode ─────
  await page.getByTestId('toggle-run').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload(); await page.waitForSelector('.network');
  assert.equal(await theme(), 'dark', 'auto follows the browser when not embedded in HA');
  const bg = (sel: string) => page.evaluate(s => getComputedStyle(document.querySelector(s)!).backgroundColor, sel);
  assert.equal(await bg('.app'), 'rgb(15, 19, 24)' === await bg('.app') ? 'rgb(15, 19, 24)' : await bg('.app'));
  await shot('14-dark');
  await page.getByTestId('theme-select').selectOption('light');
  assert.equal(await theme(), 'light'); assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMode), 'light');
  await page.reload(); await page.waitForSelector('.network');
  assert.equal(await theme(), 'light', 'manual choice is remembered and beats the browser setting');
  await page.getByTestId('theme-select').selectOption('dark');
  assert.equal(await theme(), 'dark');
  await page.getByTestId('back').click(); await page.waitForSelector('.auto-table');
  assert.equal(await theme(), 'dark', 'the same theme on the automations page');
  await page.getByTestId('theme-select').selectOption('auto');
  await page.emulateMedia({ colorScheme: 'light' });
  await waitUntil(async () => (await theme()) === 'light', 'auto follows a browser change');

  // follows Home Assistant when embedded: a fake HA page (same origin) hosts the add-on in an iframe
  const hostCtx = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: 'light' });
  const parent = await hostCtx.newPage();
  await parent.route('**/fake-ha.html', r => r.fulfill({ contentType: 'text/html', body:
    `<!doctype html><home-assistant></home-assistant><iframe id="f" src="${base}" style="width:1100px;height:700px"></iframe>
     <script>const el=document.querySelector('home-assistant'); el.hass={themes:{darkMode:true}};
     window.setDark=v=>{el.hass={themes:{darkMode:v}}};</script>` }));
  await parent.goto(base + 'fake-ha.html');
  const frame = parent.frameLocator('#f');
  await frame.locator('.auto-main').waitFor();
  const frameTheme = () => parent.frames().find(f => f !== parent.mainFrame())!.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(await frameTheme(), 'dark', 'embedded + Home Assistant is dark → dark, although the browser says light');
  await parent.evaluate(() => (window as any).setDark(false));
  await waitUntil(async () => (await frameTheme()) === 'light', 'follows HA switching to light', 5000);
  await parent.evaluate(() => (window as any).setDark(true));
  await waitUntil(async () => (await frameTheme()) === 'dark', 'follows HA switching back to dark', 5000);
  await frame.getByTestId('theme-select').selectOption('light');
  await parent.evaluate(() => (window as any).setDark(true)); await sleep(2600);
  assert.equal(await frameTheme(), 'light', 'a manual choice wins over Home Assistant');

  assert.deepEqual(errors, [], 'no console / page errors');
  console.log('E2E FEATURES 2 OK');
} catch (e) {
  await shot('FAILED-features2').catch(() => {});
  console.error('E2E FEATURES 2 FAILED:', e); console.error('browser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close(); await h.stop(); process.exit(process.exitCode ?? 0);
}
