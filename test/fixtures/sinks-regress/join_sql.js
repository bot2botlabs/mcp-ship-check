// `.join(` (the JOIN keyword) and a bare "from" must not read as SQL.
export function summarize(items, project) {
  const label = `tasks from ${project}`;
  const ids = items.map((i) => i.id).join(', ');
  return `${label}: ${ids}`;
}
