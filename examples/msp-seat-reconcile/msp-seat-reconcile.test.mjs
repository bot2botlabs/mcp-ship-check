import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
import { parseCsv, reconcile } from './msp-seat-reconcile.mjs';

const csv = s => parseCsv(s.trim() + '\n');
const map = csv('product,sku,unit_cost\nEDR-Endpoint,SEC-EDR,5.50\nMFA-Auth,SEC-MFA,2.25');
const codes = r => r.exceptions.map(e => `${e.code}:${e.tenant}:${e.product}`);

test('books that agree produce no exceptions', () => {
  const r = reconcile(csv('tenant,product,allocated,active\na,EDR-Endpoint,10,10'), csv('tenant,sku,billed_qty,unit_price\na,SEC-EDR,10,9.00'), map);
  assert.deepEqual(r.exceptions, []);
});
test('UNBILLED is priced in exact cents from the PSA line', () => {
  const r = reconcile(csv('tenant,product,allocated,active\na,EDR-Endpoint,13,13'), csv('tenant,sku,billed_qty,unit_price\na,SEC-EDR,10,9.99'), map);
  assert.deepEqual(codes(r), ['UNBILLED:a:EDR-Endpoint']);
  assert.equal(r.totals.unbilled_revenue_cents, 2997);
});
test('OVERBILLED, IDLE_SEATS and OVER_ALLOCATED', () => {
  const r = reconcile(csv('tenant,product,allocated,active\na,EDR-Endpoint,8,6\nb,MFA-Auth,5,7'),
                      csv('tenant,sku,billed_qty,unit_price\na,SEC-EDR,10,9.00\nb,SEC-MFA,7,4.00'), map);
  assert.deepEqual(codes(r), ['OVERBILLED:a:EDR-Endpoint', 'OVER_ALLOCATED:b:MFA-Auth', 'IDLE_SEATS:a:EDR-Endpoint']);
  assert.equal(r.totals.overbilled_cents, 1800);
  assert.equal(r.totals.idle_seat_cost_cents, 1100);
});
test('ORPHAN_TENANT, GHOST_BILLING and UNMAPPED_PRODUCT', () => {
  const r = reconcile(csv('tenant,product,allocated,active\nnew,EDR-Endpoint,4,4\nold,Firewall-Appliance,1,1'),
                      csv('tenant,sku,billed_qty,unit_price\ngone,SEC-EDR,3,9.00'), map);
  assert.deepEqual(codes(r), ['ORPHAN_TENANT:new:EDR-Endpoint', 'GHOST_BILLING:gone:SEC-EDR', 'UNMAPPED_PRODUCT:old:Firewall-Appliance']);
});
test('CSV parser handles quotes, embedded commas and CRLF', () => {
  assert.deepEqual(parseCsv('tenant,note\r\n"Acme, Inc.","said ""hi"""\r\n'), [{ tenant: 'Acme, Inc.', note: 'said "hi"' }]);
});
test('bad numbers are rejected, not guessed', () => {
  assert.throws(() => reconcile(csv('tenant,product,allocated,active\na,EDR-Endpoint,ten,10'), csv('tenant,sku,billed_qty,unit_price'), map), /whole number/);
  assert.throws(() => reconcile(csv('tenant,product,allocated,active'), csv('tenant,sku,billed_qty,unit_price\na,SEC-EDR,1,9.999'), map), /price/);
});
test('CLI: exit 1 on money exceptions, identical output on rerun, exit 2 on bad input', () => {
  const args = ['msp-seat-reconcile.mjs', '--inventory', 'sample/inventory.csv', '--psa', 'sample/psa.csv', '--map', 'sample/map.csv'];
  const a = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: here }), b = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: here });
  assert.equal(a.status, 1); assert.equal(a.stdout, b.stdout);
  assert.match(a.stdout, /unbilled revenue \$36\.00\/mo · overbilling exposure \$27\.00\/mo · idle-seat cost \$70\.50\/mo · 10 exception/);
  assert.equal(spawnSync(process.execPath, ['msp-seat-reconcile.mjs'], { encoding: 'utf8', cwd: here }).status, 2);
});
