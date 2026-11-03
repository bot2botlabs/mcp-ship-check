import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { project, message } from '../project.js';
import { finish, unavailable, type Result } from '../report.js';
import { listTools } from '../stdio-client.js';
export interface ToolsOptions { cmd?: string; timeout?: number; env?: Record<string, string> }
const quote = (s: string) => process.platform === 'win32' ? `"${s.replace(/"/g, '\\"')}"` : `'${s.replace(/'/g, "'\\''")}'`;
export async function tools(dir = '.', options: ToolsOptions = {}) {
  try {
    const p = await project(dir); let cmd = options.cmd;
    if (!cmd) {
      const config = p.manifest?.server?.mcp_config;
      if (config?.command) cmd = [config.command, ...(config.args ?? [])].map(s => quote(String(s).replaceAll('${__dirname}', p.dir))).join(' ');
    }
    if (!cmd) return unavailable('tools', 'Provide --cmd "node dist/index.js" or manifest.json server.mcp_config');
    const live = await listTools(cmd, p.dir, options.timeout ?? 15000, options.env);
    const results: Result[] = [{ id: 'live tools', level: 'ok', message: `${live.length} tools: ${live.map(t => t.name).join(', ')}` }];
    const declared = p.manifest?.tools;
    if (!Array.isArray(declared) || !declared.length) results.push({ id: 'manifest tools', level: 'warn', message: 'manifest declares no tools' });
    else {
      for (const t of live) if (!declared.some(d => d.name === t.name)) results.push({ id: 'tools', level: 'error', message: `Live tool ${t.name} missing from manifest.json` });
      for (const t of declared) {
        const match = live.find(l => l.name === t.name);
        if (!match) results.push({ id: 'tools', level: 'error', message: `manifest.json tool ${t.name} missing from live tools` });
        else if (normalize(t.description) !== normalize(match.description)) results.push({ id: 'description', level: 'warn', message: `${t.name}: manifest.json description ${JSON.stringify(t.description)} differs from live ${JSON.stringify(match.description)}${p.manifest.tools_generated ? ' (tools_generated: true)' : ''}` });
      }
    }
    let readme: string | undefined;
    try { readme = await readFile(join(p.dir, 'README.md'), 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (readme !== undefined) {
      const count = readme.match(/(\d+)\s+tools\b/i);
      if (count && Number(count[1]) !== live.length) results.push({ id: 'README count', level: 'warn', message: `README.md ${count[1]} tools; live ${live.length} tools` });
      const missing = (Array.isArray(declared) ? declared : []).filter(t => !readme!.includes(t.name)).map(t => t.name);
      if (missing.length) results.push({ id: 'README tools', level: 'warn', message: `README.md missing manifest.json tools: ${missing.join(', ')}` });
    }
    return finish('tools', results);
  } catch (e) { return unavailable('tools', message(e)); }
}
function normalize(s: string | undefined): string { return (s ?? '').trim().replace(/\s+/g, ' '); }
