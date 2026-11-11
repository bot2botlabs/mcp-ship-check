import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { files, tools, published, sinks, bridge, HttpError, parseArgs } from '../dist/index.js';
const fixture = name => resolve('test/fixtures', name);
const cmd = `"${process.execPath}" "${fixture('fake-server.mjs')}"`;
const declared = ['alpha', 'beta', 'gamma'].map(name => ({ name, description: `${name} tool` }));
const mismatch = ['version-mismatch','mcpname-missing','mcpname-mismatch','npm-identifier-mismatch','npm-package-version-mismatch','mcpb-sha-mismatch','schema-missing','registry-type-snake'];
for (const [name, code] of [['good',0], ...mismatch.map(n => [n,1]), ['no-package-json',2], ['only-package-json',0]]) {
  test(`files ${name}`, async () => assert.equal((await files(fixture(name))).exitCode, code));
  test(`CLI JSON ${name}`, () => {
    const run = spawnSync(process.execPath, ['dist/cli.js','files',fixture(name),'--json'], { encoding:'utf8' });
    assert.equal(run.status, code, run.stderr);
    const output = JSON.parse(run.stdout); assert.equal(output.command,'files'); assert.equal(typeof output.ok,'boolean');
    assert.ok(Array.isArray(output.results)); for (const r of output.results) { assert.equal(typeof r.id,'string'); assert.equal(typeof r.message,'string'); assert.ok(['ok','warn','error','skip'].includes(r.level)); }
  });
}
for (const [name, env, code, warning] of [
  ['matching',{},0], ['extra',{FAKE_TOOLS:JSON.stringify([...declared,{name:'extra'}])},1],
  ['missing',{FAKE_TOOLS:JSON.stringify(declared.slice(1))},1],
  ['description drift',{FAKE_TOOLS:JSON.stringify(declared.map(t => ({...t,description:'changed'})))},0,'description'],
  ['timeout',{FAKE_MODE:'timeout'},2], ['crash',{FAKE_MODE:'exit'},2], ['pagination',{PAGE_SIZE:'1'},0]
]) test(`tools ${name}`, async () => { const o = await tools(fixture('good'),{cmd,env,timeout:name === 'timeout' ? 150 : 3000}); assert.equal(o.exitCode,code,JSON.stringify(o)); if (warning) assert.ok(o.report.results.some(r=>r.id===warning && r.level==='warn')); if(name==='pagination') assert.match(o.report.results[0].message,/3 tools/); });
test('README count, absent tool and generated description warnings', async () => {
  const dir = await mkdtemp(join(tmpdir(),'ship-check-'));
  try { await cp(fixture('good'),dir,{recursive:true}); await writeFile(join(dir,'README.md'),'9 tools');
    const m=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));m.tools_generated=true;m.tools[0].description='changed';await writeFile(join(dir,'manifest.json'),JSON.stringify(m));
    const o=await tools(dir,{cmd});assert.equal(o.exitCode,0);for(const id of ['README count','README tools','description'])assert.ok(o.report.results.some(r=>r.id===id&&r.level==='warn')); assert.match(o.report.results.find(r=>r.id==='description').message,/tools_generated/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('manifest fallback command and whitespace normalization',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ship-check-'));try{await cp(fixture('good'),dir,{recursive:true});await cp(fixture('fake-server.mjs'),join(dir,'fake-server.mjs'));const m=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));m.server={mcp_config:{command:process.execPath,args:['${__dirname}/fake-server.mjs']}};m.tools[0].description=' alpha  tool\n';await writeFile(join(dir,'manifest.json'),JSON.stringify(m));const o=await tools(dir);assert.equal(o.exitCode,0);assert.ok(!o.report.results.some(r=>r.id==='description'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('tools no manifest warns and missing command cannot run',async()=>{assert.equal((await tools(fixture('good'))).exitCode,2);const o=await tools(fixture('only-package-json'),{cmd});assert.equal(o.exitCode,0);assert.ok(o.report.results.some(r=>r.message==='manifest declares no tools'));});
function stub(latest='1.2.0',name='io.demo/example') { return async url => url.includes('registry.npmjs.org') ? {'dist-tags':{latest},versions:{[latest]:{mcpName:name}}} : {server:{version:'1.2.0'}}; }
for(const [name,get,code] of [['sync',stub(),0],['npm newer',stub('1.3.0'),1],['missing mcpName',stub('1.2.0',null),1],['network',async()=>{throw new Error('offline')},2],['404',async()=>{throw new HttpError(404)},0],['local newer',stub('1.1.0'),0]])test(`published ${name}`,async()=>{const o=await published(fixture('good'),{fetchJson:get,glama:false});assert.equal(o.exitCode,code);if(name==='404')assert.ok(o.report.results.some(r=>r.level==='warn'));if(name==='local newer')assert.match(o.report.results[0].message,/unpublished local version/);});
test('error beats network failure',async()=>assert.equal((await published(fixture('good'),{glama:false,fetchJson:async url=>{if(url.includes('npmjs'))return stub('2.0.0')(url);throw new Error('offline')}})).exitCode,1));
test('Glama failure is best effort',async()=>assert.equal((await published(fixture('good'),{glamaUrl:'https://example.test',fetchJson:async url=>{if(url.includes('example.test'))throw new Error('offline');return stub()(url)}})).exitCode,0));
test('CLI bad args and human output',()=>{for(const args of [[],['bad'],['files','--timeout','1'],['tools','--timeout','0'],['tools','--env','bad']])assert.equal(spawnSync(process.execPath,['dist/cli.js',...args]).status,2);const r=spawnSync(process.execPath,['dist/cli.js','files',fixture('good')],{encoding:'utf8'});assert.match(r.stdout,/✔/);assert.match(r.stdout,/PASS/);for(const flag of ['--help','--version'])assert.equal(spawnSync(process.execPath,['dist/cli.js',flag]).status,0);});
test('args env equals and globals',()=>{const a=parseArgs(['--json','tools','--env','KEY=a=b','--env','SECOND=2']);assert.equal(a.env.KEY,'a=b');assert.equal(a.env.SECOND,'2');assert.equal(a.json,true);});

for (const name of ['deadline-desk', 'loop-desk', 'warranty-desk', 'cursor']) {
  test(`Agent Plugin ${name}: files and published without npm`, async () => {
    const dir = fixture(`plugin-${name}`), urls = [];
    const f = await files(dir);
    assert.equal(f.exitCode, 0, JSON.stringify(f));
    assert.ok(f.report.results.some(r => r.id === 'MCP URL' && r.level === 'ok'));
    const p = await published(dir, { glama: false, fetchJson: async url => {
      urls.push(url); return { server: { version: '1.2.0' } };
    }});
    assert.equal(p.exitCode, 0, JSON.stringify(p));
    assert.ok(p.report.results.some(r => r.id === 'npm' && r.level === 'skip'));
    assert.equal(urls.length, name === 'cursor' ? 1 : 0);
    assert.ok(urls.every(url => url.includes('registry.modelcontextprotocol.io')));
    const cli = spawnSync(process.execPath, ['dist/cli.js', 'files', dir], { encoding: 'utf8' });
    assert.equal(cli.status, 0); assert.match(cli.stdout, /skipping npm-only/);
  });
}
for (const [name, mutate, id] of [
  ['version', async dir => { const file=join(dir,'server.json'); const d=JSON.parse(await readFile(file)); d.version='2.0.0'; await writeFile(file,JSON.stringify(d)); }, 'version'],
  ['name', async dir => { const file=join(dir,'server.json'); const d=JSON.parse(await readFile(file)); d.name='io.demo/other'; await writeFile(file,JSON.stringify(d)); }, 'name'],
  ['URL drift', async dir => { const file=join(dir,'server.json'); const d=JSON.parse(await readFile(file)); d.remotes[0].url='https://other.test/mcp'; await writeFile(file,JSON.stringify(d)); }, 'MCP URL agreement'],
  ['insecure URL', async dir => { const file=join(dir,'.mcp.json'); const d=JSON.parse(await readFile(file)); d.mcpServers.example.url='http://example.test/mcp'; await writeFile(file,JSON.stringify(d)); }, 'MCP URL'],
  ['malformed URL', async dir => { const file=join(dir,'.mcp.json'); const d=JSON.parse(await readFile(file)); d.mcpServers.example.url='invalid'; await writeFile(file,JSON.stringify(d)); }, 'MCP URL']
]) test(`Agent Plugin rejects ${name} in files and published`, async () => {
  const dir=await mkdtemp(join(tmpdir(),'ship-plugin-'));
  try {
    await cp(fixture('plugin-cursor'),dir,{recursive:true}); await mutate(dir);
    for (const result of [await files(dir), await published(dir,{glama:false,fetchJson:async()=>({server:{version:'1.2.0'}})})]) {
      assert.equal(result.exitCode,1,JSON.stringify(result));
      assert.ok(result.report.results.some(r=>r.id===id && r.level==='error'));
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('malformed plugin JSON remains an execution error', async () => {
  const dir=await mkdtemp(join(tmpdir(),'ship-plugin-'));
  try { await writeFile(join(dir,'plugin.json'),'{'); assert.equal((await files(dir)).exitCode,2); }
  finally { await rm(dir,{recursive:true,force:true}); }
});

// ---- sinks: static Safe Sinks scan (modeled on istanbulmcp/kinocut/codex-supervisor) ----
test('sinks safe fixture: no risky shapes, sql recognized as parameterized', async () => {
  const o = await sinks(fixture('sinks-safe'));
  assert.equal(o.exitCode, 0, JSON.stringify(o.report));
  assert.ok(!o.report.results.some(r => r.level === 'warn' || r.level === 'error'), 'safe fixture must not warn');
  assert.ok(o.report.results.some(r => r.id === 'sql' && r.level === 'ok'));
  assert.ok(o.report.results.some(r => r.id === 'exec' && r.level === 'ok'));
});
test('sinks naive fixture: warns by default but does not fail the build', async () => {
  const o = await sinks(fixture('sinks-naive'));
  assert.equal(o.exitCode, 0);
  for (const id of ['exec', 'fs', 'sql']) assert.ok(o.report.results.some(r => r.id === id && r.level === 'warn'), `expected ${id} warn`);
  const warns = o.report.results.filter(r => r.level === 'warn');
  assert.ok(warns.some(r => /child_process\.exec.*interpolated/.test(r.message)), 'interpolated exec');
  assert.ok(warns.some(r => /shell: true/.test(r.message)), 'spawn shell:true');
  assert.ok(warns.some(r => /os\.system/.test(r.message)), 'os.system');
  assert.ok(warns.some(r => r.id === 'sql' && /f-string/.test(r.message)), 'f-string sql');
  assert.ok(warns.some(r => r.id === 'fs'), 'unguarded fs');
  // v2.3: child_process detected even when it is not the first import, and via dynamic import()
  assert.ok(warns.some(r => r.id === 'exec' && /exec_multiimport\.js/.test(r.message)), 'exec caught with child_process as a later import');
  assert.ok(warns.some(r => r.id === 'exec' && /exec_dynimport\.js/.test(r.message)), 'exec caught via dynamic import()');
  // v2.5: a regex literal with quotes must not hide exec on the lines below it
  assert.ok(warns.some(r => r.id === 'exec' && /regex_quote_then_exec\.js:8/.test(r.message)), 'exec caught despite a quote inside a regex literal above it');
  assert.ok(!warns.some(r => r.id === 'exec' && /regex_quote_then_exec\.js:4/.test(r.message)), 'the RegExp .exec() line is not flagged as child_process.exec');
  // v2.5: promisify(exec) and thin-wrapper aliases are treated as exec
  assert.ok(warns.some(r => r.id === 'exec' && /exec_wrapper_alias\.js:4/.test(r.message)), 'promisify(exec) alias call caught');
  assert.ok(warns.some(r => r.id === 'exec' && /exec_wrapper_alias\.js:8/.test(r.message)), 'thin-wrapper alias call caught');
});
test('sinks naive fixture: --strict promotes risky shapes to errors and fails', async () => {
  const o = await sinks(fixture('sinks-naive'), { strict: true });
  assert.equal(o.exitCode, 1);
  for (const id of ['exec', 'fs', 'sql']) assert.ok(o.report.results.some(r => r.id === id && r.level === 'error'), `expected ${id} error`);
});
test('sinks: no source to scan is a skip, not a failure', async () => {
  const o = await sinks(fixture('only-package-json'));
  assert.equal(o.exitCode, 0);
  assert.ok(o.report.results.some(r => r.level === 'skip'));
});
test('sinks v2 regression: regex .exec, .join, prose SQL, homedir config all emit 0 warns', async () => {
  const o = await sinks(fixture('sinks-regress'), { strict: true }); // strict: any FP would become an error
  assert.equal(o.exitCode, 0, JSON.stringify(o.report));
  assert.ok(!o.report.results.some(r => r.level === 'warn' || r.level === 'error'), 'v2 must not flag any known false-positive pattern');
});
// ---- v0.3.2: SQL shape precision (status/error prose) without losing real interpolated SQL ----
const sqlWarnLines = (o, file) => o.report.results
  .filter(r => r.id === 'sql' && (r.level === 'warn' || r.level === 'error') && r.message.startsWith(file + ':'))
  .map(r => Number(r.message.slice(file.length + 1).split(' ')[0]));
test('sinks sql: status/error strings with "update set", "drop index", truncate(), DDL verb lists stay silent', async () => {
  const o = await sinks(fixture('sinks-sql-prose'), { strict: true });
  assert.deepEqual(sqlWarnLines(o, 'src/messages.ts'), [], 'no prose string is a SQL sink');
  assert.ok(!sqlWarnLines(o, 'src/store.py').includes(5), 'f"Current update set changed to ..." is a message');
});
test('sinks sql: real interpolated SQL is still flagged (UPDATE/DO UPDATE SET/DROP/TRUNCATE/long SELECT/concat/f-string)', async () => {
  const o = await sinks(fixture('sinks-sql-prose'));
  assert.deepEqual(sqlWarnLines(o, 'src/queries.ts'), [3, 4, 5, 6, 7, 14]);
  assert.deepEqual(sqlWarnLines(o, 'src/store.py'), [3, 4]);
  assert.equal(o.exitCode, 0, 'warn-level by default');
});
// ---- v2.7: exec member-access precision (db.exec / regex.exec) ----
test('sinks exec: a member-access .exec is not child_process, even when exec is imported', async () => {
  const o = await sinks(fixture('sinks-exec-member'), { strict: true });
  const execErrs = o.report.results.filter(r => r.id === 'exec' && r.level === 'error');
  // the two member-access calls must NOT be flagged
  assert.ok(!execErrs.some(r => /mixed\.ts:5\b/.test(r.message)), 'db.exec(sql) must not flag');
  assert.ok(!execErrs.some(r => /mixed\.ts:6\b/.test(r.message)), 're.exec(s) must not flag');
  // the genuine imported call and the namespace call MUST flag
  assert.ok(execErrs.some(r => /mixed\.ts:7\b/.test(r.message)), 'genuine exec(c) must flag');
  assert.ok(execErrs.some(r => /mixed\.ts:8\b/.test(r.message) && /cp\.exec/.test(r.message)), 'cp.exec(c) namespace must flag');
  assert.equal(execErrs.length, 2, 'exactly the two real shell calls, nothing else');
});

// ---- v2.6: transport exposure (MCP HTTP loopback bind + DNS-rebinding protection) ----
test('sinks transport: flags missing DNS-rebinding protection and all-interface binds (strict → error)', async () => {
  const o = await sinks(fixture('sinks-transport/bad'), { strict: true });
  assert.equal(o.exitCode, 1, JSON.stringify(o.report));
  const errs = o.report.results.filter(r => r.id === 'transport' && r.level === 'error');
  // StreamableHTTPServerTransport with no enableDnsRebindingProtection
  assert.ok(errs.some(r => /bad_streamable\.ts:5/.test(r.message) && /enableDnsRebindingProtection/.test(r.message)), 'missing DNS-rebinding protection');
  // listener with a callback as the 2nd arg (host omitted → 0.0.0.0)
  assert.ok(errs.some(r => /bad_streamable\.ts:8/.test(r.message) && /no bind host/.test(r.message)), 'callback-as-host listener');
  // explicit 0.0.0.0 literal bind (even though this file DOES set protection)
  assert.ok(errs.some(r => /bad_alliface\.ts:5/.test(r.message) && /all interfaces/.test(r.message)), 'explicit 0.0.0.0 bind');
  // Python uvicorn.run(host="0.0.0.0")
  assert.ok(errs.some(r => /bad_server\.py:5/.test(r.message) && /0\.0\.0\.0/.test(r.message)), 'python uvicorn 0.0.0.0');
});
test('sinks transport: protected transport + loopback bind is green', async () => {
  const o = await sinks(fixture('sinks-transport/good'), { strict: true });
  assert.equal(o.exitCode, 0, JSON.stringify(o.report));
  assert.ok(!o.report.results.some(r => r.level === 'warn' || r.level === 'error'), 'patched transport must not flag');
  assert.ok(o.report.results.some(r => r.id === 'transport' && r.level === 'ok' && /enableDnsRebindingProtection: true/.test(r.message)), 'protection recognized');
  assert.ok(o.report.results.some(r => r.id === 'transport' && r.level === 'ok' && /loopback host/.test(r.message)), 'python loopback recognized');
});
test('sinks transport: FastMCP(host=os.getenv(..., "0.0.0.0")) is flagged; loopback default is green (v2.7)', async () => {
  const bad = await sinks(fixture('sinks-transport/bad'), { strict: true });
  assert.ok(bad.report.results.some(r => r.id === 'transport' && r.level === 'error' && /fastmcp_env\.py:3/.test(r.message) && /0\.0\.0\.0/.test(r.message)), 'FastMCP host via getenv-default 0.0.0.0 must flag');
  const good = await sinks(fixture('sinks-transport/good'), { strict: true });
  assert.ok(good.report.results.some(r => r.id === 'transport' && r.level === 'ok' && /fastmcp_env\.py:3/.test(r.message)), 'FastMCP loopback getenv-default must be ok');
  assert.ok(!good.report.results.some(r => /fastmcp_env\.py/.test(r.message) && (r.level === 'warn' || r.level === 'error')), 'good FastMCP must not warn');
});
test('sinks transport: a plain non-MCP express listener is not gated in (near-zero FP)', async () => {
  const o = await sinks(fixture('sinks-regress'), { strict: true });
  assert.ok(!o.report.results.some(r => r.id === 'transport'), 'non-MCP express app.listen must not produce a transport result');
});
test('sinks: comments and docstrings do not trigger', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ship-check-'));
  try {
    await writeFile(join(dir, 'a.js'), '// const x = exec(`rm ${y}`)\n/* fs.readFileSync(p) */\nexport const ok = 1;\n');
    await writeFile(join(dir, 'b.py'), '"""A docstring that says SELECT {x} and subprocess shell=True."""\nX = 1\n# os.system("rm " + z)\n');
    const o = await sinks(dir);
    assert.equal(o.exitCode, 0, JSON.stringify(o.report));
    assert.ok(!o.report.results.some(r => r.level === 'warn' || r.level === 'error'), 'commented/docstring code must not trigger');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('sinks CLI --json and --strict exit code', () => {
  const ok = spawnSync(process.execPath, ['dist/cli.js', 'sinks', fixture('sinks-naive'), '--json'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.command, 'sinks'); assert.ok(Array.isArray(report.results));
  for (const r of report.results) { assert.equal(typeof r.message, 'string'); assert.ok(['ok', 'warn', 'error', 'skip'].includes(r.level)); }
  const strict = spawnSync(process.execPath, ['dist/cli.js', 'sinks', fixture('sinks-naive'), '--strict'], { encoding: 'utf8' });
  assert.equal(strict.status, 1);
});
test('sinks: --strict is accepted for sinks and rejected elsewhere', () => {
  const a = parseArgs(['sinks', '.', '--strict']);
  assert.equal(a.command, 'sinks'); assert.equal(a.strict, true);
  assert.throws(() => parseArgs(['files', '.', '--strict']));
});

// ---- v0.3.0: bridge (mcp-remote pins and flags in client configs / install snippets) ----
const byServer = (o, id, server) => o.report.results.filter(r => r.id === id && r.details?.server === server);
test('bridge: each rule fires on the matching invocation', async () => {
  const o = await bridge(fixture('bridge-bad'));
  assert.equal(o.exitCode, 1);
  assert.equal(byServer(o, 'bridge-cve-2026-108716', 'acme-old-range')[0]?.level, 'warn', '0.14.3 without --device-code: warn');
  assert.match(byServer(o, 'bridge-cve-2026-108716', 'acme-old-range')[0].message, /outside the advisory's listed range \(unconfirmed upstream fix\)/);
  assert.equal(byServer(o, 'bridge-cve-2026-108716', 'acme-device')[0]?.level, 'error', 'in range + --device-code: error');
  assert.equal(byServer(o, 'bridge-cve-2025-6514', 'acme-ancient')[0]?.level, 'error');
  assert.equal(byServer(o, 'bridge-allow-http', 'acme-cleartext')[0]?.level, 'error');
  assert.equal(byServer(o, 'bridge-unpinned', 'acme-floating')[0]?.level, 'info');
  assert.equal(byServer(o, 'bridge-unpinned', 'acme-range')[0]?.level, 'info', 'JSONC .vscode/mcp.json with a range pin');
  assert.equal(byServer(o, 'bridge-device-code', 'acme-new-device')[0]?.level, 'warn', '--device-code outside the range: warn, fix unconfirmed');
  assert.equal(byServer(o, 'bridge-device-code', 'acme-device').length, 0, 'no duplicate device-code warning when the CVE rule already fired');
  const md = o.report.results.find(r => r.id === 'bridge-cve-2026-108716' && r.details?.file === 'README.md');
  assert.equal(md?.details.line, 6, 'Markdown fenced snippet found at its line');
  assert.ok(!o.report.results.some(r => /patched/i.test(r.message)), 'never claims "patched"');
});
test('bridge --strict: warnings become errors, info stays info', async () => {
  const o = await bridge(fixture('bridge-bad'), { strict: true });
  assert.ok(!o.report.results.some(r => r.level === 'warn'));
  assert.equal(byServer(o, 'bridge-cve-2026-108716', 'acme-old-range')[0]?.level, 'error');
  assert.equal(byServer(o, 'bridge-unpinned', 'acme-floating')[0]?.level, 'info');
});
test('bridge: current pin, loopback --allow-http, look-alike packages and prose mentions stay green', async () => {
  const o = await bridge(fixture('bridge-good'), { strict: true });
  assert.equal(o.exitCode, 0, JSON.stringify(o.report));
  assert.ok(!o.report.results.some(r => r.level === 'error' || r.level === 'warn'));
  assert.equal(byServer(o, 'bridge-allow-http', 'acme-local')[0]?.level, 'ok');
  assert.ok(!o.report.results.some(r => ['decoy-a', 'decoy-b'].includes(r.details?.server)), 'my-mcp-remote-helper / @acme/mcp-remote are not mcp-remote');
  assert.ok(!o.report.results.some(r => r.details?.spec === '0.14.3'), 'a version mentioned in prose is not an install instruction');
  assert.match(o.report.results[0].message, /3 mcp-remote invocation/);
});
test('bridge: no invocations is a pass', async () => {
  const o = await bridge(fixture('bridge-none'));
  assert.equal(o.exitCode, 0);
  assert.match(o.report.results[0].message, /no mcp-remote invocations found/);
});
test('bridge CLI: --json output and exit code; args gate flags', () => {
  const run = spawnSync(process.execPath, ['dist/cli.js', 'bridge', fixture('bridge-bad'), '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).command, 'bridge');
  assert.equal(parseArgs(['bridge', '.', '--strict']).strict, true);
  assert.throws(() => parseArgs(['bridge', '--cmd', 'x']), /not supported by bridge/);
});
// ---- v0.3.1: bridge recall (inline runner commands, unfenced JSON configs) without prose false positives ----
test('bridge: inline runner commands in prose are found at their line', async () => {
  const o = await bridge(fixture('bridge-inline'));
  const at = (id, line) => o.report.results.find(r => r.id === id && r.details?.file === 'README.md' && r.details?.line === line);
  assert.equal(at('bridge-cve-2026-108716', 3)?.level, 'warn', '`npx -y mcp-remote@0.14.3 <url>` in a code span');
  assert.equal(at('bridge-unpinned', 5)?.level, 'info', '`bunx mcp-remote <url>` in a code span');
  assert.equal(at('bridge-pin', 7)?.level, 'ok', '``… pnpm dlx mcp-remote@0.1.37 <url>`` (double-backtick span, runner mid-command)');
});
test('bridge: an unfenced JSON client config in Markdown is read as a config', async () => {
  const o = await bridge(fixture('bridge-inline'));
  const unpinned = byServer(o, 'bridge-unpinned', 'acme-unfenced')[0];
  assert.equal(unpinned?.level, 'info');
  assert.equal(unpinned.details.line, 22, 'line of the mcp-remote arg inside the unfenced block');
  assert.equal(byServer(o, 'bridge-allow-http', 'acme-unfenced')[0]?.level, 'ok', 'loopback --allow-http');
});
test('bridge: prose mentions, runner-less or URL-less spans, look-alikes and non-JSON braces stay silent', async () => {
  const o = await bridge(fixture('bridge-inline'), { strict: true });
  assert.match(o.report.results[0].message, /4 mcp-remote invocation/, 'exactly 3 inline + 1 unfenced');
  const lines = o.report.results.filter(r => r.details?.file === 'README.md').map(r => r.details.line);
  for (const l of [11, 12, 13, 14]) assert.ok(!lines.includes(l), `line ${l} is prose, not an instruction`);
  assert.ok(!o.report.results.some(r => r.id === 'bridge-cve-2025-6514'), 'mcp-remote@0.1.10 only appears in prose');
});
test('bridge fixtures stay generic (example.com / localhost URLs, acme-* server names)', async () => {
  const { readdir } = await import('node:fs/promises');
  for (const d of ['bridge-bad', 'bridge-good', 'bridge-none', 'bridge-inline']) {
    for (const f of await readdir(fixture(d), { recursive: true, withFileTypes: true })) {
      if (!f.isFile()) continue;
      const text = await readFile(join(f.parentPath ?? f.path, f.name), 'utf8');
      for (const n of text.match(/"([\w.-]+)"\s*:\s*\{/g) ?? []) assert.match(n, /"(mcpServers|servers|acme[\w-]*|decoy-[ab])"/, `${d}/${f.name}: server name ${n} must be generic`);
      for (const u of text.match(/https?:\/\/[^\s"'`)]+/g) ?? []) assert.match(u, /^https?:\/\/(mcp\.example\.com|localhost)(:\d+)?\//, `${d}/${f.name}: ${u}`);
    }
  }
});

