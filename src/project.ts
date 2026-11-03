import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export async function optionalJson(path: string): Promise<any | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
export async function project(dir: string) {
  dir = resolve(dir);
  if (!(await stat(dir)).isDirectory()) throw new Error(`Not a directory: ${dir}`);
  const pkg = await optionalJson(join(dir, 'package.json'));
  const plugins: [string, any][] = [], configs: [string, any][] = [];
  if (!pkg) {
    for (const name of ['plugin.json', '.cursor-plugin/plugin.json']) {
      const doc = await optionalJson(join(dir, name));
      if (doc) plugins.push([name, doc]);
    }
    for (const name of ['mcp.json', '.mcp.json']) {
      const doc = await optionalJson(join(dir, name));
      if (doc) configs.push([name, doc]);
    }
    // Skills alone are not enough to identify an MCP plugin.
    if (!plugins.length && !configs.length) throw new Error(`No package.json or plugin manifest/MCP config in ${dir}`);
    for (const [name, doc] of plugins) {
      if (typeof doc.mcpServers === 'string') {
        const path = resolve(dir, doc.mcpServers);
        if (!path.startsWith(dir + '/')) throw new Error(`${name} mcpServers path must stay inside the project`);
        const config = await optionalJson(path);
        if (!config) throw new Error(`${name} MCP config missing: ${doc.mcpServers}`);
        if (!configs.some(([n]) => resolve(dir, n) === path)) configs.push([doc.mcpServers, config]);
      } else if (doc.mcpServers) configs.push([name, { mcpServers: doc.mcpServers }]);
    }
  }
  return { dir, pkg, plugins, configs, manifest: await optionalJson(join(dir, 'manifest.json')), server: await optionalJson(join(dir, 'server.json')) };
}
export function message(e: unknown): string { return e instanceof Error ? e.message : String(e); }
