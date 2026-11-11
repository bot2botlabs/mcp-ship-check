#!/usr/bin/env node
// msp-seat-reconcile — deterministic seat reconciliation for an MSP:
// vendor seat inventory vs. what the PSA bills. Zero dependencies, read-only,
// no network, no LLM. Money is handled in integer cents.
//
// Usage: node msp-seat-reconcile.mjs --inventory inv.csv --psa psa.csv --map map.csv [--json]
//   inventory.csv: tenant,product,allocated,active      (from the vendor side)
//   psa.csv:       tenant,sku,billed_qty,unit_price      (from your PSA agreements)
//   map.csv:       product,sku,unit_cost                 (your price book)
// Exit code: 0 = books agree, 1 = money-impacting exceptions, 2 = bad input.
import { readFileSync } from 'node:fs';

export function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(f => f.trim() !== '')) rows.push(row); row = []; }
    else field += c;
  }
  row.push(field); if (row.some(f => f.trim() !== '')) rows.push(row);
  const [head, ...data] = rows; if (!head) return [];
  const keys = head.map(h => h.trim().toLowerCase());
  return data.map(r => Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? '').trim()])));
}
const int = (v, what) => { if (!/^\d+$/.test(v)) throw new Error(`${what}: expected a whole number, got "${v}"`); return Number(v); };
const cents = (v, what) => { const m = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(v); if (!m) throw new Error(`${what}: expected a price like 4.50, got "${v}"`); return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0')); };
const usd = c => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;

export function reconcile(inventory, psa, map) {
  const sku = new Map(), cost = new Map();
  for (const m of map) { sku.set(m.product, m.sku); cost.set(m.product, m.unit_cost ? cents(m.unit_cost, `map ${m.product} unit_cost`) : null); }
  const billed = new Map(); // tenant|sku -> {qty, price}
  for (const [n, p] of psa.entries()) {
    const k = `${p.tenant}|${p.sku}`, prev = billed.get(k);
    const qty = int(p.billed_qty, `psa row ${n + 2} billed_qty`), price = cents(p.unit_price, `psa row ${n + 2} unit_price`);
    billed.set(k, { qty: (prev?.qty ?? 0) + qty, price, seen: false });
  }
  const tenantsWithBilling = new Set(psa.map(p => p.tenant));
  const out = [];
  for (const [n, r] of inventory.entries()) {
    const allocated = int(r.allocated, `inventory row ${n + 2} allocated`), active = int(r.active, `inventory row ${n + 2} active`);
    if (active > allocated) out.push({ code: 'OVER_ALLOCATED', tenant: r.tenant, product: r.product, detail: `${active} active, ${allocated} allocated (vendor overage / true-up exposure)`, seats: active - allocated, monthly_cents: null });
    const s = sku.get(r.product);
    if (!s) { out.push({ code: 'UNMAPPED_PRODUCT', tenant: r.tenant, product: r.product, detail: `no SKU in map.csv for "${r.product}"`, monthly_cents: null }); continue; }
    const b = billed.get(`${r.tenant}|${s}`);
    if (b) b.seen = true;
    if (!b && (allocated > 0 || active > 0)) {
      out.push({ code: tenantsWithBilling.has(r.tenant) ? 'UNBILLED' : 'ORPHAN_TENANT', tenant: r.tenant, product: r.product,
        detail: `${active} active / ${allocated} allocated, nothing billed${tenantsWithBilling.has(r.tenant) ? ` for ${s}` : ' (no PSA agreement for this tenant)'}`,
        monthly_cents: null, seats: active });
      continue;
    }
    if (!b) continue;
    if (active > b.qty) out.push({ code: 'UNBILLED', tenant: r.tenant, product: r.product, detail: `${active} active, ${b.qty} billed`, seats: active - b.qty, monthly_cents: (active - b.qty) * b.price });
    // Overbilled = billing for seats that are neither allocated nor in use. Billing for seats in use
    // beyond the allocation is correct billing; that gap is the vendor's OVER_ALLOCATED, not the customer's.
    const ceiling = Math.max(allocated, active);
    if (b.qty > ceiling) out.push({ code: 'OVERBILLED', tenant: r.tenant, product: r.product, detail: `${b.qty} billed, ${allocated} allocated, ${active} active (credit/refund exposure)`, seats: b.qty - ceiling, monthly_cents: -(b.qty - ceiling) * b.price });
    const c = cost.get(r.product);
    if (allocated > active) out.push({ code: 'IDLE_SEATS', tenant: r.tenant, product: r.product, detail: `${allocated} allocated, ${active} active`, seats: allocated - active, monthly_cents: c == null ? null : -(allocated - active) * c });
  }
  for (const [k, b] of billed) if (!b.seen) { const [tenant, s] = k.split('|'); out.push({ code: 'GHOST_BILLING', tenant, product: s, detail: `billing ${b.qty} × ${s} with no matching vendor seats (offboarded? mapping error?)`, seats: b.qty, monthly_cents: null }); }
  const order = ['UNBILLED', 'ORPHAN_TENANT', 'OVERBILLED', 'GHOST_BILLING', 'OVER_ALLOCATED', 'IDLE_SEATS', 'UNMAPPED_PRODUCT'];
  out.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code) || a.tenant.localeCompare(b.tenant) || a.product.localeCompare(b.product));
  const sum = code => out.filter(o => o.code === code && typeof o.monthly_cents === 'number').reduce((t, o) => t + o.monthly_cents, 0);
  return { exceptions: out, totals: { unbilled_revenue_cents: sum('UNBILLED'), overbilled_cents: -sum('OVERBILLED'), idle_seat_cost_cents: -sum('IDLE_SEATS') } };
}

function main(argv) {
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const [inv, psa, map] = ['--inventory', '--psa', '--map'].map(arg);
  if (!inv || !psa || !map) { console.error('usage: msp-seat-reconcile --inventory inv.csv --psa psa.csv --map map.csv [--json]'); return 2; }
  let r;
  try { r = reconcile(parseCsv(readFileSync(inv, 'utf8')), parseCsv(readFileSync(psa, 'utf8')), parseCsv(readFileSync(map, 'utf8'))); }
  catch (e) { console.error(`input error: ${e.message}`); return 2; }
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    const label = { UNBILLED: 'unbilled', OVERBILLED: 'credit exposure', IDLE_SEATS: 'idle cost' };
    for (const e of r.exceptions) {
      const money = typeof e.monthly_cents === 'number' ? `  [${label[e.code]} ${usd(Math.abs(e.monthly_cents))}/mo]` : (e.code === 'UNBILLED' || e.code === 'ORPHAN_TENANT' ? '  [unpriced: no PSA line to price from]' : '');
      console.log(`${e.code.padEnd(16)} ${e.tenant.padEnd(18)} ${e.product.padEnd(18)} ${e.detail}${money}`);
    }
    const t = r.totals;
    console.log(`\nunbilled revenue ${usd(t.unbilled_revenue_cents)}/mo · overbilling exposure ${usd(t.overbilled_cents)}/mo · idle-seat cost ${usd(t.idle_seat_cost_cents)}/mo · ${r.exceptions.length} exception(s)`);
  }
  return r.exceptions.some(e => ['UNBILLED', 'ORPHAN_TENANT', 'OVERBILLED', 'GHOST_BILLING'].includes(e.code)) ? 1 : 0;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
