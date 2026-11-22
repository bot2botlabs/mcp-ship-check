export function q(table: string, cols: string, id: string, order: string, n: number, term: string) {
  const a = `SELECT * FROM ${table}`;
  const b = `SELECT ${cols} FROM ${table} t`;
  const c = `SELECT id, ${cols} FROM items JOIN ${table} ON items.id = owner_id`;
  const d = `SELECT * FROM ${table} WHERE id = ${id}`;
  const e = `SELECT * FROM items WHERE name = '${term}'`;
  const f = `SELECT * FROM ${table} ORDER BY ${order}`;
  const g = `SELECT * FROM ${table} LIMIT ${n}`;
  const h = `SELECT * FROM ${table}; DROP TABLE ${table}`;
  const i = `SELECT count(${cols}) FROM items`;
  const j = `SELECT * FROM ${table} WHERE ${term}`;
  return [a, b, c, d, e, f, g, h, i, j];
}
