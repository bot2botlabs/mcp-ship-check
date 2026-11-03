import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { files, tools, published, HttpError, parseArgs } from '../dist/index.js';
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
