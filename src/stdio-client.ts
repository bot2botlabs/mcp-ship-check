import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { version } from './version.js';
export interface Tool { name: string; description?: string }
export async function listTools(command: string, cwd: string, timeout: number, env: Record<string, string> = {}): Promise<Tool[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', env: { ...process.env, ...env }, stdio: 'pipe' });
    let stderr = '', done = false, id = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const lines = createInterface({ input: child.stdout });
    const stop = (error?: Error, tools?: Tool[]) => {
      if (done) return; done = true; clearTimeout(timer); lines.close();
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
      for (const request of pending.values()) request.reject(error ?? new Error('Client closed'));
      pending.clear();
      if (error) reject(new Error(`${error.message}${stderr ? `; stderr: ${stderr}` : ''}`)); else resolve(tools!);
    };
    const timer = setTimeout(() => stop(new Error(`MCP server timeout after ${timeout}ms`)), timeout);
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-2048); });
    child.on('error', e => stop(e));
    child.on('exit', (code, signal) => stop(new Error(`MCP server exited (${code ?? signal})`)));
    child.stdin.on('error', e => stop(e));
    lines.on('line', line => {
      let reply: any; try { reply = JSON.parse(line); } catch { return; }
      if (!reply || typeof reply !== 'object') return;
      const request = pending.get(reply.id); if (!request) return;
      pending.delete(reply.id);
      if (reply.error) request.reject(new Error(`JSON-RPC error: ${JSON.stringify(reply.error)}`)); else request.resolve(reply.result);
    });
    const send = (body: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...body }) + '\n');
    const request = (method: string, params: object) => new Promise<any>((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); send({ id: key, method, params }); });
    void (async () => {
      try {
        await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-ship-check', version } });
        send({ method: 'notifications/initialized' });
        const tools: Tool[] = []; let cursor: string | undefined; const seen = new Set<string>();
        do {
          const page = await request('tools/list', cursor ? { cursor } : {});
          if (!Array.isArray(page?.tools)) throw new Error('Invalid tools/list response');
          tools.push(...page.tools); cursor = page.nextCursor;
          if (cursor) { if (seen.has(cursor)) throw new Error('Repeated tools/list cursor'); seen.add(cursor); }
        } while (cursor);
        stop(undefined, tools);
      } catch (e) { stop(e instanceof Error ? e : new Error(String(e))); }
    })();
  });
}
