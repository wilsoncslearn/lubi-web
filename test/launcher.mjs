import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';

const hash=s=>createHash('sha256').update(s).digest('hex');
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('LUBI_')&&!['PORT','HOST'].includes(k)));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'lubi-environment-'));mkdirSync(join(dir,'scripts'));
  copyFileSync(resolve('scripts/environment.mjs'),join(dir,'scripts/environment.mjs'));
  writeFileSync(join(dir,'scripts/probe.mjs'),`import{ensureConfigured}from'./environment.mjs';import{createHash}from'node:crypto';if(process.argv.includes('--setup'))ensureConfigured();console.log('RESULT:'+JSON.stringify({db:process.env.LUBI_DB_PATH,key:process.env.LUBI_KEY_PATH,port:process.env.PORT,passwordHash:process.env.LUBI_PASSWORD?createHash('sha256').update(process.env.LUBI_PASSWORD).digest('hex'):null}));`);
  const put=(path,text='')=>{const file=join(dir,path);mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,text);};
  const run=(env={},setup=false)=>{const r=spawnSync(process.execPath,[join(dir,'scripts/probe.mjs'),...(setup?['--setup']:[])],{cwd:tmpdir(),env:{...cleanEnv(),...env},encoding:'utf8'});const result=r.stdout.split('RESULT:')[1];return{...r,result:result?JSON.parse(result.trim()):null};};
  return{dir,put,run,close:()=>rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})};
}

test('environment selects the sole legacy DB and refuses ambiguous defaults or relative paths',()=>{
  const f=fixture();try{
    assert.equal(f.run().result.db,join(f.dir,'data/lubi.db'));
    f.put('apps/api/data/lubi.db');assert.equal(f.run().result.db,join(f.dir,'apps/api/data/lubi.db'));
    f.put('data/lubi.db');const ambiguous=f.run();assert.notEqual(ambiguous.status,0);assert.match(ambiguous.stderr,/Two existing databases/);
    assert.notEqual(f.run({LUBI_DB_PATH:'data/lubi.db'}).status,0);
    assert.equal(f.run({LUBI_DB_PATH:join(f.dir,'apps/api/data/lubi.db')}).result.db,join(f.dir,'apps/api/data/lubi.db'));
  }finally{f.close();}
});
test('inherited env wins over .env.local over .env; paths are rooted at the project, not cwd',()=>{
  const f=fixture();try{
    f.put('.env','LUBI_PASSWORD=first-synthetic-password\nPORT=4300\nLUBI_DB_PATH=data/custom.db\n');
    f.put('.env.local','LUBI_PASSWORD=local-synthetic-password\nPORT=4400\nLUBI_KEY_PATH=data/custom.key\n');
    const r=f.run({PORT:'4500',LUBI_PASSWORD:'inherited-synthetic-password'});assert.equal(r.status,0);assert.equal(r.result.port,'4500');assert.equal(r.result.passwordHash,hash('inherited-synthetic-password'));assert.equal(r.result.db,join(f.dir,'data/custom.db'));assert.equal(r.result.key,join(f.dir,'data/custom.key'));
    assert.equal(f.run().result.passwordHash,hash('local-synthetic-password'));
  }finally{f.close();}
});
test('setup generates a unique secret without logging it, and never replaces invalid owner configuration',()=>{
  const a=fixture(),b=fixture();try{
    const one=a.run({},true),two=b.run({},true);assert.equal(one.status,0);assert.equal(two.status,0);assert.notEqual(one.result.passwordHash,two.result.passwordHash);
    const text=readFileSync(join(a.dir,'.env.local'),'utf8'),secret=text.match(/^LUBI_PASSWORD=(.+)$/m)[1];assert(secret.length>=32);assert(!one.stdout.includes(secret));assert.equal(a.run({},true).result.passwordHash,one.result.passwordHash);
    b.put('.env.local','LUBI_PASSWORD=too-short\n');assert.notEqual(b.run({},true).status,0);assert.equal(readFileSync(join(b.dir,'.env.local'),'utf8'),'LUBI_PASSWORD=too-short\n');
  }finally{a.close();b.close();}
});

// Exercise the ACTUAL .cmd, not a reimplementation, with an explicit disposable DB.
// Its displayed password is a public synthetic fixture, never the owner's password.
if(process.platform==='win32')test('Windows one-click launcher builds, serves and authenticates an isolated DB without changing real .env.local',async()=>{
  const root=process.cwd(),local=join(root,'.env.local'),before=existsSync(local)?hash(readFileSync(local)):null;
  const dir=mkdtempSync(join(tmpdir(),'lubi-cmd-'));const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const password='synthetic-launcher-test-not-a-real-secret';let child,logs='',completed=false,apiPid;
  try{
    child=spawn('cmd.exe',['/d','/s','/c','call "启动 Lubi.cmd"'],{cwd:root,windowsHide:true,windowsVerbatimArguments:true,env:{...cleanEnv(),LUBI_PASSWORD:password,LUBI_DB_PATH:join(dir,'isolated.db'),LUBI_KEY_PATH:join(dir,'isolated.key'),LUBI_NO_OPEN:'1',HOST:'127.0.0.1',PORT:String(port)},stdio:['pipe','pipe','pipe']});
    child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);child.stdin.end();
    const base='http://127.0.0.1:'+port;let ready=false;
    for(let n=0;n<900;n++){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await delay(100);}
    assert(ready,'Actual Windows launcher failed: '+logs.slice(-5000));
    const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/id="root"/);
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const snapshot=await fetch(base+'/api/vault/snapshot',{headers:{cookie}});assert.equal(snapshot.status,200);assert.equal((await snapshot.json()).documents.length,0);assert(existsSync(join(dir,'isolated.db')));
    assert.equal(existsSync(local)?hash(readFileSync(local)):null,before,'Launcher changed the actual local owner configuration');completed=true;
  }finally{
    for(const line of logs.split(/\r?\n/)){try{const value=JSON.parse(line);if(value.msg?.includes('Server listening at http://127.0.0.1:'+port))apiPid=value.pid;}catch{}}
    writeFileSync(resolve('test/.out/launcher-report.json'),JSON.stringify({completed,launcherPid:child?.pid,apiPid,ownerEnvironmentUnchanged:(existsSync(local)?hash(readFileSync(local)):null)===before},null,2));
    if(child&&child.exitCode===null){const done=once(child,'close');spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});await done;}
    if(apiPid)spawnSync('taskkill.exe',['/PID',String(apiPid),'/T','/F'],{stdio:'ignore'});
    await delay(400);await rm(dir,{recursive:true,force:true,maxRetries:30,retryDelay:150});
  }
});
