// Ordinary status and error strings that mention SQL words. None of these is a query.
const truncate = (s: string, n = 80) => (s.length > n ? s.slice(0, n) + '…' : s);

export function statusLines(id: string, err: Error, name: string, verb: string, desc: string) {
  return [
    `Moving records to update set ${id}`,
    `Update set verification failed: expected ${id}`,
    `Failed to list drop index suggestions: ${err.message}`,
    `  ${truncate(desc, 120)}`,
    `Task '${truncate(name, 100)}' did not return an id`,
    'DDL (CREATE, ALTER, DROP, TRUNCATE) is never allowed here: ' + verb,
    `${verb} without a WHERE clause is rejected; use TRUNCATE via the ddl tool instead`,
    `Run a read-only report for the account. Select the rows you need. Then copy totals from ${name}.`,
  ];
}
