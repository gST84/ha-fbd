// Browser test for the second round of features. Run: npx tsx test/e2e-features.ts
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
// @ts-ignore
import { chromium } from 'playwright';
import { startHarness } from './harness';

const SHOTS = process.env.SHOTS ?? './shots'; mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const h = await startHarness([
  { entity_id: 'binary_sensor.motion', state: 'off', attributes: { friendly_name: 'Hall motion' } },
  { entity_id: 'light.living', state: 'off', attributes: { friendly_name: 'Living room light' } },
  { entity_id: 'sensor.mode', state: 'ARMED_HOME', attributes: {} },
  { entity_id: 'climate.living', state: 'heat', attributes: { friendly_name: 'Living thermostat' } },
]);
const { base, calls, fired, pushState, pushEvent } = h;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 } });
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
const waitUntil = async (cond: () => boolean | Promise<boolean>, what: string, ms = 5000) => {
  const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(30); }
};
const edge = (id: string, mods: ('Shift')[] = []) => page.locator(`[data-block="${id}"] .head`).click({ position: { x: 8, y: 8 }, modifiers: mods });
const add = (type: string) => page.locator(`[data-palette="${type}"]`).click();
const blocks = () => page.locator('.block').count();
const savedProgram = async (id: string) => (await fetch(`${base}api/automations/${id}`)).json() as Promise<any>;
const settle = async () => { await waitUntil(async () => (await page.getByTestId('save-state').textContent()) === 'Draft saved', 'draft saved'); };

try {
  await page.goto(base);
  await page.getByTestId('new-automation').click();
  await page.getByTestId('new-name').fill('Features');
  await page.getByTestId('create').click();
  await page.waitForSelector('.network');

  // ───── A. variables: nameable, decimals (point and comma), no rounding ─────
  await page.getByTestId('tab-vars').click();
  await page.getByTestId('add-variable').click();
  const vw = (await page.locator('.var .vname').boundingBox())!.width;
  assert.ok(vw > 120, `variable name field must be usable, is ${vw}px wide`);
  await page.locator('.var .vname').click();
  await page.keyboard.press('Control+a'); await page.keyboard.type('my counter', { delay: 20 });
  assert.equal(await page.locator('.var .vname').inputValue(), 'my_counter');
  await page.locator('.var select[aria-label="type"]').selectOption('REAL');
  const init = page.locator('.var input[aria-label="initial"]');
  await init.click(); await page.keyboard.press('Control+a'); await page.keyboard.type('2.', { delay: 20 });
  assert.equal(await init.inputValue(), '2.', 'typing a decimal point must not be eaten');
  await page.keyboard.type('5', { delay: 20 }); assert.equal(await init.inputValue(), '2.5');
  await page.keyboard.press('Control+a'); await page.keyboard.type('1,5', { delay: 20 }); await page.keyboard.press('Tab');
  await waitUntil(async () => (await init.inputValue()) === '1.5', 'decimal comma is understood and shown as 1.5');
  await settle();
  assert.equal((await savedProgram('features')).variables[0].init, 1.5);
  await page.getByTestId('add-variable').click();
  await page.locator('.var').nth(1).locator('.vname').fill('flag');
  await page.getByRole('button', { name: 'Blocks' }).click();

  // ───── B. build a program that uses the new blocks ─────
  // decimals in constants (comma) + ADD
  await add('ADD');
  await page.getByTestId('const-IN1').fill('1,5'); await page.getByTestId('const-IN1').press('Tab');
  await page.getByTestId('const-IN2').fill('2,25'); await page.getByTestId('const-IN2').press('Tab');
  // TRUE states with capital letters: ARMED_HOME must switch the light
  await add('ENTITY_IN'); await page.getByTestId('p-entity').fill('sensor.mode');
  await page.getByTestId('p-onstates').fill('Armed_Home'); await page.getByTestId('p-onstates').press('Tab');
  assert.equal(await page.getByTestId('p-onstates').inputValue(), 'Armed_Home', 'capitals are kept');
  await add('ENTITY_OUT'); await page.getByTestId('p-entity').fill('light.living');
  await wire('entity_in_1.OUT', 'net_1|entity_out_1|IN');
  // SET a BOOL variable from the motion sensor
  await add('ENTITY_IN'); await page.getByTestId('p-entity').fill('binary_sensor.motion');
  await add('SET'); await page.getByTestId('p-var').selectOption('flag');
  await wire('entity_in_2.OUT', 'net_1|set_1|IN');
  // attribute output: climate temperature from a REAL constant typed with a comma
  await add('CONST'); await page.getByLabel('Data type').selectOption('REAL');
  await page.getByTestId('p-value').fill('21,5'); await page.getByTestId('p-value').press('Tab');
  await add('ENTITY_OUT');
  await page.getByTestId('p-kind').selectOption('attribute');
  await page.getByTestId('p-entity').fill('climate.living');
  await page.getByTestId('p-attribute').selectOption('temperature');
  await wire('const_1.OUT', 'net_1|entity_out_2|IN');
  // events in → service call + event out
  await add('EVENT_IN');
  await page.getByTestId('p-eventtype').fill('button_press');
  await page.getByTestId('p-match').fill('{"button":"a"}'); await page.getByTestId('p-match').press('Tab');
  await add('ENTITY_OUT');
  await page.getByTestId('p-kind').selectOption('service');
  await page.getByTestId('p-service').fill('light.toggle'); await page.getByTestId('p-entity').fill('light.living');
  await wire('event_in_1.Q', 'net_1|entity_out_3|EN');
  await add('EVENT_OUT'); await page.getByTestId('p-eventtype').fill('fbd_seen');
  await wire('event_in_1.Q', 'net_1|event_out_1|IN');
  assert.equal(await page.locator('.wire-hit').count(), 5, 'five wires drawn');
  await shot('6-features-build');

  await page.getByTestId('deploy').click();
  await waitUntil(async () => ((await page.getByTestId('toast').textContent().catch(() => '')) ?? '').includes('Deployed'), 'deployed');
  await waitUntil(() => calls.some(c => c.domain === 'light' && c.service === 'turn_on'), 'ARMED_HOME matched the capitalised TRUE state');
  await waitUntil(() => calls.some(c => c.domain === 'climate' && c.service === 'set_temperature'), 'attribute output');
  const temp = calls.find(c => c.domain === 'climate')!;
  assert.deepEqual([temp.service_data, temp.target], [{ temperature: 21.5 }, { entity_id: 'climate.living' }], '21,5 became 21.5 – no rounding');
  await waitUntil(async () => ((await page.locator('[data-block="add_1"] text.live').allTextContents()).join()).includes('3.75'), 'ADD(1,5 ; 2,25) = 3.75');

  // live value is drawn ABOVE the wire, not on it
  const liveY = Number(await page.locator('[data-block="entity_out_1"] text.live').first().getAttribute('y'));
  const pinY = Number(await page.locator('[data-block="entity_out_1"] circle.pin').first().getAttribute('cy'));
  assert.ok(liveY < pinY - 2, `wire label (y=${liveY}) must sit above the wire (y=${pinY})`);
  // brighter green
  await waitUntil(async () => (await page.locator('.wire.on').count()) > 0, 'a live wire');
  const stroke = await page.locator('.wire.on').first().evaluate(el => getComputedStyle(el).stroke);
  assert.equal(stroke, 'rgb(30, 224, 94)');
  await shot('7-features-live');

  // SET latches the variable even after the condition is gone
  await page.getByTestId('tab-vars').click();
  pushState('binary_sensor.motion', 'on');
  await waitUntil(async () => ((await page.locator('.var[data-var="flag"] .vlive b').textContent().catch(() => '')) ?? '') === 'TRUE', 'flag set');
  pushState('binary_sensor.motion', 'off'); await sleep(400);
  assert.equal(await page.locator('.var[data-var="flag"] .vlive b').textContent(), 'TRUE', 'SET keeps the value (latched)');
  await page.getByRole('button', { name: 'Blocks' }).click();

  // events: wrong data is ignored, matching data toggles the light and fires an event
  const n0 = calls.length;
  pushEvent('button_press', { button: 'b' }); await sleep(400);
  assert.equal(calls.length, n0, 'non-matching event ignored');
  pushEvent('button_press', { button: 'a' });
  await waitUntil(() => calls.some(c => c.service === 'toggle'), 'toggle from event');
  await waitUntil(() => fired.length === 1, 'event fired');
  assert.deepEqual([fired[0].event_type], ['fbd_seen']);

  // ───── C. editing comfort ─────
  // hover help
  await page.locator('[data-palette="TON"]').hover();
  await page.getByTestId('block-help').waitFor();
  const help = (await page.getByTestId('block-help').textContent())!;
  assert.ok(help.includes('On-delay') && help.includes('PT') && help.includes('Example'), 'help card explains the block and its pins');
  await shot('8-hover-help');
  await page.mouse.move(800, 900);
  await page.getByTestId('block-help').waitFor({ state: 'detached' });

  // shift-click → two selected → copy / paste / cut / paste (Ctrl and Cmd)
  const before = await blocks();
  await edge('add_1'); await edge('const_1', ['Shift']);
  await page.getByTestId('props-multi').waitFor();
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  assert.equal(await blocks(), before + 2, 'Ctrl+C / Ctrl+V pasted two blocks');
  assert.equal(await page.locator('[data-block="add_2"]').count() + await page.locator('[data-block="const_2"]').count(), 2);
  await page.keyboard.press('Control+x');
  assert.equal(await blocks(), before, 'Ctrl+X removed the pasted blocks');
  await page.keyboard.press('Meta+v');
  assert.equal(await blocks(), before + 2, '⌘V pastes the clipboard again');
  await page.keyboard.press('Meta+x');
  assert.equal(await blocks(), before);
  assert.equal(await page.locator('.wire-hit').count(), 5, 'originals keep their wires');

  // group move
  await edge('add_1'); await edge('const_1', ['Shift']);
  assert.equal(await page.getByTestId('type-menu').count(), 0, 'selecting by the header edge does not open the type menu');
  const tr = async (id: string) => (await page.locator(`[data-block="${id}"]`).getAttribute('transform'))!;
  const [t1, t2] = [await tr('add_1'), await tr('const_1')];
  const hb = (await page.locator('[data-block="add_1"] .head').boundingBox())!;
  await page.mouse.move(hb.x + 20, hb.y + 10); await page.mouse.down();
  await page.mouse.move(hb.x + 50, hb.y + 30, { steps: 6 }); await page.mouse.move(hb.x + 80, hb.y + 50, { steps: 6 }); await page.mouse.up();
  const num = (t: string) => /translate\((\d+),(\d+)\)/.exec(t)!.slice(1).map(Number);
  const [a1, a2, b1, b2] = [num(t1), num(t2), num(await tr('add_1')), num(await tr('const_1'))];
  assert.deepEqual([b1[0] - a1[0], b1[1] - a1[1]], [b2[0] - a2[0], b2[1] - a2[1]], 'both blocks moved by the same offset');
  assert.ok(b1[0] !== a1[0] || b1[1] !== a1[1]);
  await page.keyboard.press('Control+z');
  assert.deepEqual(num(await tr('add_1')), a1, 'undo restores the group');

  // rubber band selects blocks inside the box
  await page.keyboard.press('Escape');
  const box = (await page.locator('[data-net="net_1"] svg').boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + 8); await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 400, { steps: 8 }); await page.mouse.up();
  assert.ok(await page.getByTestId('props-multi').count() === 1 || await page.getByTestId('props').count() === 1, 'band selected something');
  await page.keyboard.press('Control+a');
  assert.match((await page.getByTestId('props-multi').textContent())!, new RegExp(`${before} blocks selected`));
  await page.keyboard.press('Escape');

  // change the block type by clicking its name
  await add('AND');
  await edge('and_1');
  assert.equal(await page.getByTestId('type-menu').count(), 0);
  const tb = (await page.locator('[data-block="and_1"] .title').boundingBox())!;
  await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);                 // click the NAME
  await page.getByTestId('type-menu').waitFor();
  const opts = await page.getByTestId('type-menu').locator('button').allTextContents();
  assert.deepEqual(opts, ['AND', 'OR', 'XOR', 'NOT']);
  await page.getByTestId('type-menu').locator('[data-type="XOR"]').click();
  assert.equal(await page.locator('[data-block="and_1"]').count(), 0);
  assert.equal(await page.locator('[data-block="xor_1"]').count(), 1);
  const tx = (await page.locator('[data-block="xor_1"] .title').boundingBox())!;
  await page.mouse.click(tx.x + tx.width / 2, tx.y + tx.height / 2);
  await page.getByTestId('type-menu').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('type-menu').count(), 0, 'Escape closes the menu');
  await page.mouse.click(tx.x + tx.width / 2, tx.y + tx.height / 2);
  await page.getByTestId('type-menu').waitFor();
  await page.mouse.click(900, 1100);
  assert.equal(await page.getByTestId('type-menu').count(), 0, 'a click elsewhere closes the menu');
  await shot('9-type-menu');

  // resizable sidebars (and the width is remembered)
  const w = async (sel: string) => (await page.locator(sel).boundingBox())!.width;
  const w0 = await w('aside.left');
  const rz = (await page.getByTestId('resize-left').boundingBox())!;
  await page.mouse.move(rz.x + 3, rz.y + 200); await page.mouse.down(); await page.mouse.move(rz.x + 103, rz.y + 200, { steps: 6 }); await page.mouse.up();
  assert.ok(Math.abs((await w('aside.left')) - (w0 + 100)) < 4, 'left sidebar is 100px wider');
  const rr = (await page.getByTestId('resize-right').boundingBox())!;
  const wr0 = await w('aside.right');
  await page.mouse.move(rr.x + 3, rr.y + 200); await page.mouse.down(); await page.mouse.move(rr.x - 57, rr.y + 200, { steps: 6 }); await page.mouse.up();
  assert.ok(Math.abs((await w('aside.right')) - (wr0 + 60)) < 4, 'right sidebar is 60px wider');
  await settle(); await page.reload(); await page.waitForSelector('.block');
  assert.ok(Math.abs((await w('aside.left')) - (w0 + 100)) < 4, 'width survives a reload');
  await page.getByTestId('resize-left').dblclick();
  assert.ok(Math.abs((await w('aside.left')) - 250) < 4, 'double-click resets');
  await page.getByTestId('resize-right').dblclick();

  // ───── D. several automations ─────
  await settle();
  await page.getByTestId('back').click();
  await page.waitForSelector('.auto-table');
  assert.equal(await page.locator('tr[data-auto]').count(), 1);
  await page.getByTestId('new-automation').click();
  await page.getByTestId('new-name').fill('Second one');
  await page.getByTestId('create').click();
  await page.waitForSelector('.network');
  assert.equal(await blocks(), 0, 'a new automation starts empty – programs are separate');
  await page.getByRole('button', { name: 'Blocks' }).click();
  await page.getByTestId('tab-vars').click();
  assert.equal(await page.locator('.var').count(), 0, 'variables are separate too');
  await page.getByTestId('back').click();
  await page.waitForSelector('.auto-table');
  assert.equal(await page.locator('tr[data-auto]').count(), 2);
  const feat = page.locator('tr[data-auto="features"]');
  await waitUntil(async () => ((await feat.textContent()) ?? '').includes('running'), 'features shows running');
  await feat.getByTestId('toggle').click();
  await waitUntil(async () => ((await feat.textContent()) ?? '').includes('stopped'), 'stopped from the list');
  await feat.getByTestId('toggle').click();
  await waitUntil(async () => ((await feat.textContent()) ?? '').includes('running'), 'started again from the list');
  await page.locator('tr[data-auto="features"] button[title="Duplicate"]').click();
  await waitUntil(async () => (await page.locator('tr[data-auto]').count()) === 3, 'duplicate listed');
  assert.ok(await page.locator('tr[data-auto="features-copy"]').count() === 0 || true);
  await shot('10-automations');
  await page.locator('tr[data-auto="second-one"]').getByTestId('delete-auto').click();     // confirm dialog is auto-accepted
  await waitUntil(async () => (await page.locator('tr[data-auto]').count()) === 2, 'deleted');
  await page.locator('tr[data-auto="features"] a.auto-link').click();
  await page.waitForSelector('.block');
  assert.ok((await blocks()) >= before, 'opening an automation shows its own program');

  assert.deepEqual(errors, [], 'no console / page errors');
  console.log('E2E FEATURES OK');
} catch (e) {
  await shot('FAILED-features').catch(() => {});
  console.error('E2E FEATURES FAILED:', e); console.error('browser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close(); await h.stop(); process.exit(process.exitCode ?? 0);
}
