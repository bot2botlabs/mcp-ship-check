import { createInterface } from 'node:readline';
const mode = process.env.FAKE_MODE ?? process.argv[2];
if (mode === 'exit') process.exit(1);
const tools = JSON.parse(process.env.FAKE_TOOLS ?? (process.argv[3] || '[{"name":"alpha","description":"alpha tool"},{"name":"beta","description":"beta tool"},{"name":"gamma","description":"gamma tool"}]'));
const size = Number(process.env.PAGE_SIZE ?? process.argv[4] ?? tools.length) || 1;
createInterface({ input: process.stdin }).on('line', line => {
  const r = JSON.parse(line);
  if (mode === 'timeout' || !r.id) return;
  let result;
  if (r.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } };
  if (r.method === 'tools/list') { const offset = Number(r.params?.cursor ?? 0); result = { tools: tools.slice(offset, offset + size), ...(offset + size < tools.length ? { nextCursor: String(offset + size) } : {}) }; }
  console.log('non-json log');
  console.log(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }));
});
