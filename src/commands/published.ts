import { project, message } from '../project.js';
import { finish, unavailable, type Result } from '../report.js';
export class HttpError extends Error { constructor(public status: number) { super(`HTTP ${status}`); } }
export type FetchJson = (url: string, timeoutMs: number) => Promise<any>;
export const fetchJson: FetchJson = async (url, timeoutMs) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new HttpError(response.status);
  return response.json();
};
export interface PublishedOptions { timeout?: number; glama?: boolean; glamaUrl?: string; fetchJson?: FetchJson }
// Semver precedence, including numeric prerelease identifiers. Build metadata has no precedence.
function compare(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('+')[0].split('-');
  const [ac, ...ap] = parse(a), [bc, ...bp] = parse(b);
  const an = ac.split('.').map(Number), bn = bc.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (an[i] !== bn[i]) return an[i] > bn[i] ? 1 : -1;
  if (!ap.length || !bp.length) return ap.length === bp.length ? 0 : ap.length ? -1 : 1;
  const aa = ap.join('-').split('.'), bb = bp.join('-').split('.');
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === bb[i]) continue;
    if (aa[i] === undefined || bb[i] === undefined) return aa[i] === undefined ? -1 : 1;
    const numericA = /^\d+$/.test(aa[i]), numericB = /^\d+$/.test(bb[i]);
    if (numericA && numericB) return Number(aa[i]) > Number(bb[i]) ? 1 : -1;
    if (numericA !== numericB) return numericA ? -1 : 1;
    return aa[i] > bb[i] ? 1 : -1;
  }
  return 0;
}
export async function published(dir = '.', options: PublishedOptions = {}) {
  try {
    const p = await project(dir), results: Result[] = []; let failed = false;
    const get = options.fetchJson ?? fetchJson, timeout = options.timeout ?? 15000;
    const check = async (id: string, url: string, extract: (data: any) => string, after?: (data: any) => void) => {
      try {
        const data = await get(url, timeout), latest = extract(data);
        if (typeof latest !== 'string') throw new Error('response missing latest version');
        const delta = compare(latest, p.pkg.version);
        results.push({ id, level: latest === p.pkg.version ? 'ok' : delta > 0 ? 'error' : 'warn', message: `${id} latest ${latest}, local ${p.pkg.version}${delta < 0 ? ' (unpublished local version)' : ''}` });
        after?.(data);
      } catch (e) {
        if ((e as HttpError).status === 404) results.push({ id, level: 'warn', message: id === 'npm' ? 'not on npm' : 'not in registry' });
        else { failed = true; results.push({ id, level: 'skip', message: `could not check: ${message(e)}` }); }
      }
    };
    await check('npm', `https://registry.npmjs.org/${encodeURIComponent(p.pkg.name)}`, d => d['dist-tags']?.latest, d => {
      if (p.pkg.mcpName) {
        const value = d.versions?.[d['dist-tags'].latest]?.mcpName;
        results.push({ id: 'npm mcpName', level: value === p.pkg.mcpName ? 'ok' : 'error', message: `published package.json mcpName ${value ?? '(missing)'}; local package.json mcpName ${p.pkg.mcpName}` });
      }
    });
    if (p.server || p.pkg.mcpName) await check('registry', `https://registry.modelcontextprotocol.io/v0/servers/${encodeURIComponent(p.pkg.mcpName ?? p.server.name)}/versions/latest`, d => d.server?.version);
    else results.push({ id: 'registry', level: 'skip', message: 'No server.json or package.json mcpName' });
    let glamaUrl = options.glamaUrl;
    const repo = typeof p.pkg.repository === 'string' ? p.pkg.repository : p.pkg.repository?.url;
    const match = repo?.match(/github\.com[:/]([^/]+)\/([^/#?]+)/);
    if (!glamaUrl && match) glamaUrl = `https://glama.ai/api/mcp/v1/servers/${match[1]}/${match[2].replace(/\.git$/, '')}`;
    if (options.glama !== false && glamaUrl) {
      try { await get(glamaUrl, timeout); results.push({ id: 'glama', level: 'ok', message: 'Glama listing reachable' }); }
      catch (e) { results.push({ id: 'glama', level: 'skip', message: `could not check: ${message(e)}` }); }
    } else results.push({ id: 'glama', level: 'skip', message: options.glama === false ? 'Disabled by --no-glama' : 'No Glama URL or GitHub repository' });
    return finish('published', results, failed);
  } catch (e) { return unavailable('published', message(e)); }
}
