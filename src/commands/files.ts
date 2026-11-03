import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { project, message } from '../project.js';
import { finish, unavailable, type Result } from '../report.js';
export async function files(dir = '.') {
  try {
    const p = await project(dir), results: Result[] = [];
    const add = (id: string, level: Result['level'], message: string) => results.push({ id, level, message });
    if (!p.pkg) return finish('files', pluginChecks(p));
    const documents = [['package.json', p.pkg], ['manifest.json', p.manifest], ['server.json', p.server]] as const;
    for (const [name, doc] of documents.slice(1)) if (!doc) add(name, 'skip', `${name} missing (optional)`);
    for (let i = 0; i < documents.length; i++) for (let j = i + 1; j < documents.length; j++) {
      const [a, av] = documents[i], [b, bv] = documents[j];
      if (av && bv) add('version', av.version === bv.version ? 'ok' : 'error', `${a} ${av.version} ${av.version === bv.version ? '=' : '≠'} ${b} ${bv.version}`);
    }
    if (p.manifest) {
      const strip = (s: string = '') => s.replace(/^@[^/]+\//, '');
      add('name', strip(p.pkg.name) === strip(p.manifest.name) ? 'ok' : 'warn', `package.json ${p.pkg.name}, manifest.json ${p.manifest.name}`);
    }
    if (p.server) {
      add('mcpName', p.pkg.mcpName && p.pkg.mcpName === p.server.name ? 'ok' : 'error', `package.json mcpName ${p.pkg.mcpName ?? '(missing)'}; server.json name ${p.server.name} (mcpName required for registry publishing)`);
      const schema = p.server.$schema;
      add('$schema', schema ? 'ok' : 'error', schema ? `server.json revision ${String(schema).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? schema}` : 'server.json $schema missing');
      for (const entry of p.server.packages ?? []) {
        if ('registry_type' in entry) add('registryType', 'error', 'server.json packages uses registry_type; use registryType');
        if (entry.registryType === 'npm') {
          add('npm identifier', entry.identifier === p.pkg.name ? 'ok' : 'error', `server.json identifier ${entry.identifier}; package.json name ${p.pkg.name}`);
          if (entry.version !== undefined) add('npm version', entry.version === p.pkg.version ? 'ok' : 'error', `server.json package version ${entry.version}; package.json version ${p.pkg.version}`);
        }
        if (entry.registryType === 'mcpb') {
          const url = new URL(entry.identifier);
          const version = url.pathname.split('/').find(s => /^v?\d+\.\d+\.\d+(?:[-+].*)?$/.test(s));
          if (version && version.replace(/^v/, '') !== p.pkg.version) add('mcpb version', 'warn', `server.json identifier version ${version}; package.json version ${p.pkg.version}`);
          if (entry.fileSha256) {
            const name = basename(decodeURIComponent(url.pathname));
            const top = (await readdir(p.dir)).filter(n => n.endsWith('.mcpb'));
            const candidates = [join(p.dir, name), join(p.dir, 'dist', name), ...(top.length === 1 ? [join(p.dir, top[0])] : [])];
            let data: Buffer | undefined;
            for (const path of candidates) { try { data = await readFile(path); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
            if (!data) add('mcpb sha256', 'skip', `No local file for server.json ${entry.identifier}`);
            else { const hash = createHash('sha256').update(data).digest('hex'); add('mcpb sha256', hash === entry.fileSha256 ? 'ok' : 'error', `local ${name} sha256 ${hash}; server.json fileSha256 ${entry.fileSha256}`); }
          }
        }
      }
    }
    return finish('files', results);
  } catch (e) { return unavailable('files', message(e)); }
}

// Plugin names may be registry-qualified in server.json (io.example/name).
export function pluginChecks(p: Awaited<ReturnType<typeof project>>): Result[] {
  const results: Result[] = [];
  const add = (id: string, level: Result['level'], message: string) => results.push({ id, level, message });
  add('npm', 'skip', 'No package.json: skipping npm-only metadata checks (Agent Plugin)');
  const docs: [string, any][] = [...p.plugins, ...p.configs];
  if (p.manifest) docs.push(['manifest.json', p.manifest]);
  if (p.server) docs.push(['server.json', p.server]);
  for (const field of ['version', 'name']) {
    const values = docs.filter(([, d]) => d[field] !== undefined);
    if (values.length < 2) add(field, 'skip', `Fewer than two documents declare ${field}`);
    for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
      const [a, av] = values[i], [b, bv] = values[j];
      const normalize = (v: any) => field === 'name' && typeof v === 'string' ? v.split('/').at(-1) : v;
      add(field, normalize(av[field]) === normalize(bv[field]) ? 'ok' : 'error', `${a} ${av[field]}; ${b} ${bv[field]}`);
    }
  }
  const endpoints: { source: string; name?: string; url: any }[] = [];
  for (const [source, doc] of p.configs) {
    for (const [name, config] of Object.entries(doc.mcpServers ?? doc) as [string, any][]) {
      if (config?.url !== undefined) endpoints.push({ source: `${source} ${name}`, name, url: config.url });
    }
  }
  for (const remote of p.server?.remotes ?? []) endpoints.push({ source: 'server.json remotes', url: remote.url });
  const pluginName = p.plugins.find(([, d]) => d.name)?.[1].name;
  // Multi-server plugins may intentionally use distinct server names and endpoints.
  const names = new Set(endpoints.flatMap(e => e.name ? [e.name] : []));
  if (pluginName && names.size === 1) {
    const name = [...names][0];
    add('name', pluginName === name ? 'ok' : 'error', `plugin name ${pluginName}; MCP server name ${name}`);
  }
  for (const endpoint of endpoints) {
    let valid = false;
    try { valid = new URL(endpoint.url).protocol === 'https:'; } catch {}
    add('MCP URL', valid ? 'ok' : 'error', `${endpoint.source}: ${endpoint.url} (HTTPS required)`);
  }
  for (let i = 0; i < endpoints.length; i++) for (let j = i + 1; j < endpoints.length; j++) {
    const a = endpoints[i], b = endpoints[j];
    if (a.name && b.name && a.name !== b.name) continue;
    add('MCP URL agreement', a.url === b.url ? 'ok' : 'error', `${a.source} ${a.url}; ${b.source} ${b.url}`);
  }
  if (!endpoints.length) add('MCP URL', 'skip', 'No hosted MCP URLs declared');
  if (!p.server) add('server.json', 'skip', 'server.json missing (optional)');
  else add('$schema', p.server.$schema ? 'ok' : 'error', p.server.$schema ? `server.json revision ${p.server.$schema}` : 'server.json $schema missing');
  return results;
}
