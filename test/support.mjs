import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { demoData } from '../packages/plugin-runtime/test/helpers/demo-data.mjs';
export const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
export const testDate = '2026-10-18';
export const testPassword = 'synthetic-test-only-not-a-real-password';
export const output = resolve('test/.out');
mkdirSync(output,{recursive:true});
export async function startApp() {
  const folder=mkdtempSync(join(tmpdir(),'lubi-parity-'));
  const child=spawn(process.execPath,['--import','tsx','apps/api/src/server.ts'],{cwd:process.cwd(),env:{...process.env,PORT:'0',HOST:'127.0.0.1',LUBI_PASSWORD:testPassword,LUBI_DB_PATH:join(folder,'isolated.db'),LUBI_QUIET:'1',LUBI_ALLOW_LOCAL_AI:'1',LUBI_HTTPS:'0',LUBI_TRUST_PROXY:'0',LUBI_DEV_ORIGINS:'',LUBI_KEY_PATH:join(folder,'isolated-credentials.key'),LUBI_SECRET_KEY:''},stdio:['ignore','pipe','pipe']});
  let logs='',spawnError;child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);child.on('error',e=>{spawnError=e;});
  if(child.pid)writeFileSync(join(folder,'test-owner.json'),JSON.stringify({kind:'lubi-synthetic-api',pid:child.pid,project:process.cwd(),createdAt:new Date().toISOString()}));
  const stop=async()=>{if(child.pid&&child.exitCode===null){const closed=once(child,'close');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.kill();await closed;clearTimeout(timer);}await delay(200);await rm(folder,{recursive:true,force:true,maxRetries:20,retryDelay:150});};
  // The server itself binds port zero and reports its assigned address. Reserving
  // then releasing a port races other Windows Chromium processes under load.
  let base,ready=false;
  for(let i=0;i<600;i++){
    base=logs.match(/LUBI_READY (https?:\/\/[^\s]+)/)?.[1];
    if(base){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}}
    if(spawnError||child.exitCode!==null)break;await delay(100);
  }
  if(!ready){await stop();throw new Error('Isolated server failed (exit '+child.exitCode+'): '+(spawnError?.message||'')+' '+logs);}
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:testPassword})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=(path,method='GET',body,headers={})=>fetch(base+'/api'+path,{method,headers:{cookie,...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const json=async(path,method='GET',body)=>{const response=await request(path,method,body);if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);return response.status===204?null:response.json();};
  return {base,folder,pid:child.pid,request,json,cookie,logs:()=>logs,stop};
}
export async function seed(app, date=new Date(2026,9,18,14,0,0)) {
  const fixture=demoData(date,840);
  await app.json('/vault/file','PUT',{path:'任务/任务数据.json',kind:'file',text:JSON.stringify({version:14,tasks:fixture.tasks},null,2)+'\n',expectedRevision:0});
  for(const [date,records] of fixture.journals){const text=`---\ndate: ${date}\n---\n\n# ${date}\n\n## 记录\n${records.map(row=>'- '+row).join('\n')}\n`;await app.json('/vault/file','PUT',{path:`日记/${date}.md`,kind:'file',text,expectedRevision:0});}
  await app.json('/vault/settings','PUT',{data:{onboardingDone:true,legacyScanDone:true},expectedRevision:0});
  return fixture;
}
export async function browserOptions() {
  const { existsSync }=await import('node:fs');
  const candidates=[process.env.LUBI_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
  const executablePath=candidates.find(p=>p&&existsSync(p));
  return {headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']};
}
