# msp-seat-reconcile

A reference example: a deterministic seat and license reconciliation for MSPs. It compares what a security vendor's console says each tenant has (seats allocated and seats in use) with what your PSA bills, and reports every gap in dollars.

It pairs with [Shelf Watch #3](../../docs/shelf-watch-3.md), whose Enterprise MCP Reference Blueprint keeps license, trial and billing tools **off** the surface external AI clients can reach. This example is the other half of that design: when you do need license and billing numbers, compute them in plain code, outside the model and outside any MCP write tool.

- **Zero dependencies.** One Node.js file and the standard library. No network calls, no LLM.
- **Read-only.** It reads three CSV exports and prints a report. It never changes a license, a seat or an agreement.
- **Exact money.** Prices are parsed into integer cents. There's no floating-point drift, and the same inputs always give the same report.

## Run it

```bash
cd examples/msp-seat-reconcile
node msp-seat-reconcile.mjs --inventory sample/inventory.csv --psa sample/psa.csv --map sample/map.csv
node msp-seat-reconcile.mjs --inventory sample/inventory.csv --psa sample/psa.csv --map sample/map.csv --json
node --test
```

Exit codes: `0` the books agree · `1` money-impacting exceptions to review · `2` bad input (it rejects a value it can't parse instead of guessing).

## Inputs

| File | Columns | Where it comes from |
|---|---|---|
| `inventory.csv` | `tenant, product, allocated, active` | The vendor side: a license/inventory export, or read-only API/MCP calls |
| `psa.csv` | `tenant, sku, billed_qty, unit_price` | Your PSA's recurring-billing / agreement export |
| `map.csv` | `product, sku, unit_cost` | Your price book (`unit_cost` is optional; it prices idle seats) |

`tenant` must be the same key in both exports. Mapping vendor account IDs to PSA company IDs is the first job, and it's usually where reconciliations break.

## What it flags

| Code | Rule | Who acts |
|---|---|---|
| `UNBILLED` | more seats in use than billed | Billing: add to the agreement |
| `ORPHAN_TENANT` | vendor seats, but no PSA agreement for that tenant | Billing / onboarding |
| `OVERBILLED` | billed more than **both** allocated and in use | Billing: credit, fix the agreement |
| `GHOST_BILLING` | the PSA bills a tenant/SKU with no vendor seats | Billing / offboarding |
| `OVER_ALLOCATED` | more seats in use than allocated | Ops: true-up in the vendor console |
| `IDLE_SEATS` | allocated but not in use | Ops: right-size at renewal |
| `UNMAPPED_PRODUCT` | a vendor product with no SKU in the price book | Finance |

Billing for seats in use beyond the allocation is **not** overbilling. That's correct billing on top of a vendor overage (`OVER_ALLOCATED`), and it goes to a different person. A test pins this case.

## Where an AI agent fits

1. Pull the vendor side with a **read-only** identity. No write scopes, and no license or trial tools.
2. Run this script. The math is deterministic, in integer cents.
3. People make the changes: billing in the PSA, true-ups and trial changes in the vendor console.
4. If you want an LLM in the loop, give it the *finished* report to summarize or to draft a client email. It never computes a number and never touches a license.

## Sample data

Everything in `sample/` is fictional: the tenants, the generic product names (`EDR-Endpoint`, `MFA-Auth`, `Firewall-Appliance`, `DNS-Filter`), the SKUs and every price. Swap in the product names from your own vendor's export. `sample/expected-output.txt` is the exact output of the first command above.
