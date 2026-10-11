// End-to-end: fake HA → real server → headless Chromium driving the editor with the mouse.
// Run:  npx tsx test/e2e.ts   (needs `playwright` + a Chromium install; not part of `npm test`)
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
// @ts-ignore
import { chromium } from 'playwright';
import { startHarness } from './harness';

const SHOTS = process.env.SHOTS ?? './shots'; mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const h = await startHarness();
const { base, calls, pushState } = h;

// ───────── browser ─────────
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 820 } });
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push('pageerror: ' + e.message));
// (the 422 is the deliberately refused deploy)
page.on('console', (m: any) => { if (m.type() === 'error' && !m.text().includes('status of 422')) errors.push('console: ' + m.text()); });
page.on('dialog', (d: any) => d.accept());
const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const center = async (sel: string) => { const b = await page.locator(sel).boundingBox(); assert.ok(b, `no box for ${sel}`); return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 }; };
async function wire(from: string, to: string) {
  const a = await center(`[data-out="${from}"]`), b = await center(`[data-in="${to}"]`);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 }); await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}
const wiresCount = () => page.locator('.wire-hit').count();
const waitUntil = async (cond: () => boolean | Promise<boolean>, what: string, ms = 5000) => {
  const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(30); }
};

try {
  await page.goto(base);
  assert.equal(await page.title(), 'FBD Automation');
  await page.getByText('No automations yet').waitFor();
  await shot('0-automations-empty');
  await page.getByTestId('new-automation').click();
  await page.getByTestId('new-name').fill('Hall light');
  await page.getByTestId('create').click();
  await page.waitForSelector('.network');
  assert.equal(await page.getByTestId('auto-name').inputValue(), 'Hall light');
  await waitUntil(async () => (await page.getByTestId('ha-pill').textContent())!.includes('connected'), 'HA connected');

  // 1. build:  motion → TOF(3s) → light  (palette clicks, property fields, mouse-drawn wires)
  await page.locator('[data-palette="ENTITY_IN"]').click();
  await page.getByTestId('p-entity').fill('binary_sensor.motion');
  await page.locator('[data-palette="TOF"]').click();
  await page.getByTestId('const-PT').fill('3s');
  await page.locator('[data-palette="ENTITY_OUT"]').click();
  await page.getByTestId('p-entity').fill('light.living');
  assert.equal(await page.locator('.block').count(), 3);

  await wire('entity_in_1.OUT', 'net_1|tof_1|IN');
  await wire('tof_1.Q', 'net_1|entity_out_1|IN');
  assert.equal(await wiresCount(), 2, 'two wires drawn with the mouse');

  // a REAL output must NOT be accepted by the BOOL input of the TOF
  await page.locator('[data-palette="ADD"]').click();
  await wire('add_1.OUT', 'net_1|tof_1|IN');
  assert.equal(await wiresCount(), 2, 'type-incompatible wire refused');
  await shot('1-build');

  // 2. deploy → first scan writes the initial output state
  await page.getByTestId('deploy').click();
  await waitUntil(async () => ((await page.getByTestId('toast').textContent().catch(() => '')) ?? '').includes('Deployed'), 'deploy toast');
  await waitUntil(() => calls.length >= 1, 'first service call');
  assert.deepEqual([calls[0].domain, calls[0].service, calls[0].target], ['light', 'turn_off', { entity_id: 'light.living' }]);
  await waitUntil(async () => (await page.getByTestId('run-pill').textContent()) === 'running', 'running pill');

  // 3. live: motion ON → light ON immediately; wires turn green
  pushState('binary_sensor.motion', 'on');
  await waitUntil(() => calls.some(c => c.service === 'turn_on'), 'turn_on after motion');
  await waitUntil(async () => (await page.locator('.wire.on').count()) >= 2, 'live green wires');
  await waitUntil(async () => (await page.locator('.block.live-on').count()) === 3, 'entity_in, tof and entity_out outlined green');
  assert.equal(await page.locator('.block.live-on[data-block="add_1"]').count(), 0, 'ADD (REAL output) is not active');
  await shot('2-live-on');

  // 4. motion OFF → TOF keeps the light on for ~3 s, then turns it off
  const n0 = calls.length, t0 = Date.now();
  pushState('binary_sensor.motion', 'off');
  await sleep(2000);
  assert.equal(calls.length, n0, 'no write during the off-delay');
  await waitUntil(() => calls.length > n0, 'turn_off after off-delay', 4000);
  const dt = Date.now() - t0;
  assert.equal(calls.at(-1).service, 'turn_off');
  await waitUntil(async () => (await page.locator('.block.live-on').count()) === 0, 'green outlines gone when everything is off');
  assert.ok(dt >= 2800 && dt <= 4500, `off-delay took ${dt} ms`);

  // 5. drag a block (grid snapping) and undo it with Ctrl+Z
  const pos = async () => page.locator('[data-block="tof_1"]').getAttribute('transform');
  const before = await pos();
  const hdr = await page.locator('[data-block="tof_1"] .title').boundingBox();
  await page.mouse.move(hdr!.x + 10, hdr!.y + 5); await page.mouse.down();
  await page.mouse.move(hdr!.x + 70, hdr!.y + 25, { steps: 8 }); await page.mouse.move(hdr!.x + 110, hdr!.y + 45, { steps: 8 });
  await page.mouse.up();
  const after = await pos();
  assert.notEqual(after, before);
  const m = /translate\((\d+),(\d+)\)/.exec(after!)!;
  assert.ok(+m[1] % 20 === 0 && +m[2] % 20 === 0, 'snapped to the 20 px grid');
  await page.locator('.net-scroll svg').click({ position: { x: 600, y: 160 } });     // focus the canvas
  await page.keyboard.press('Control+z');
  assert.equal(await pos(), before, 'undo restores the position');
  await page.keyboard.press('Control+y');
  assert.equal(await pos(), after, 'redo moves it again');

  // 6. select + delete a block with the keyboard
  await page.locator('[data-block="add_1"] .head').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('[data-block="add_1"]').count(), 0);

  // 7. variables: declare one, use it in a VAR_READ block
  await page.getByTestId('tab-vars').click();
  await page.getByTestId('add-variable').click();
  await page.locator('.var .vname').fill('counter');
  await page.locator('.var select[aria-label="type"]').selectOption('INT');
  await page.getByRole('button', { name: 'Blocks' }).click();
  await page.locator('[data-palette="VAR_READ"]').click();
  await page.getByTestId('p-var').selectOption('counter');
  assert.match((await page.locator('[data-block="var_read_1"] .sub').textContent())!, /\$counter/);

  // 8. second network + drag & drop from the palette
  await page.getByTestId('add-network').click();
  assert.equal(await page.locator('.network').count(), 2);
  await page.locator('[data-palette="NOT"]').dragTo(page.locator('[data-net="net_2"] svg'), { targetPosition: { x: 200, y: 80 } });
  assert.equal(await page.locator('[data-net="net_2"] [data-block]').count(), 1, 'palette drag & drop created a block in network 2');
  await shot('3-two-networks');

  // 9. invalid program: deploy is refused and the running program keeps running
  await page.locator('[data-palette="ENTITY_IN"]').click();            // empty entity id → problem
  await waitUntil(async () => +((await page.getByTestId('problem-count').textContent()) ?? '0') > 0, 'problem listed');
  await page.getByTestId('deploy').click();
  await waitUntil(async () => ((await page.getByTestId('toast').textContent().catch(() => '')) ?? '').includes('refused'), 'refused toast');
  assert.equal(await page.getByTestId('run-pill').textContent(), 'running');
  assert.ok(await page.locator('.block.err').count() >= 1, 'offending block outlined in red');
  await shot('4-problem');
  await page.getByTestId('delete-block').click();
  await waitUntil(async () => (await page.getByTestId('problem-count').textContent()) === '0', 'problems cleared');

  // 10. draft survives a reload
  await waitUntil(async () => (await page.getByTestId('save-state').textContent()) === 'Draft saved', 'draft saved');
  const blocksBefore = await page.locator('.block').count();
  await page.reload(); await page.waitForSelector('.block');
  assert.equal(await page.locator('.block').count(), blocksBefore);
  assert.equal(await page.locator('.network').count(), 2);
  assert.equal(await page.locator('.vars').count(), 0);                 // palette tab is the default
  await shot('5-after-reload');

  // 11. stop
  await page.getByTestId('toggle-run').click();
  await waitUntil(async () => (await page.getByTestId('run-pill').textContent()) === 'stopped', 'stopped');

  assert.deepEqual(errors, [], 'no console / page errors');
  console.log('E2E OK  (' + calls.length + ' HA service calls observed)');
} catch (e) {
  await shot('FAILED').catch(() => {});
  console.error('E2E FAILED:', e);
  console.error('browser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close(); await h.stop();
  process.exit(process.exitCode ?? 0);
}
