// Parameterized IN-clause: placeholders is a generated "?,?,?" string, values bound separately.
export function byIds(db, ids) {
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT id FROM memories WHERE id IN (${placeholders})`).all(ids);
}
