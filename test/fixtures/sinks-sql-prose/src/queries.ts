// Real SQL built by interpolation: each of these must still be flagged.
export function queries(table: string, cols: string, id: string, where: string) {
  const a = `UPDATE ${table} SET status = 'done' WHERE id = ${id}`;
  const b = ` DO UPDATE SET ${cols}`;
  const c = `DROP TABLE IF EXISTS ${table}`;
  const d = `TRUNCATE ${table}`;
  const e = `SELECT
      t.id AS id, t.name AS name, t.owner AS owner, t.created_at AS created_at,
      CASE WHEN t.flags & 1 = 1 THEN 'archived' WHEN t.flags & 2 = 2 THEN 'hidden' ELSE 'active' END AS state,
      CASE WHEN t.flags & 4 = 4 THEN 'locked' ELSE 'open' END AS lock_state,
      t.updated_at AS updated_at
    FROM items t
    WHERE ${where}`;
  const f = 'DELETE FROM items WHERE id = ' + id;
  return [a, b, c, d, e, f];
}
