import { ensureConfigured, root } from './environment.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
ensureConfigured();
if(process.argv.includes('--build')||!existsSync(join(root,'apps/web/dist/index.html'))){
  const npm=process.env.npm_execpath;
  const result=npm?spawnSync(process.execPath,[npm,'run','build'],{cwd:root,stdio:'inherit'}):spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{cwd:root,stdio:'inherit',shell:process.platform==='win32'});
  if(result.status!==0)process.exit(result.status||1);
}
const port=Number(process.env.PORT),host=process.env.HOST;
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
const localHost=['0.0.0.0','::'].includes(host)?'127.0.0.1':host.includes(':')?'['+host+']':host;
const backend=`http://${localHost}:${port}`;
const url=process.env.LUBI_PUBLIC_URL||backend;if(!['http:','https:'].includes(new URL(url).protocol))throw new Error('Invalid LUBI_PUBLIC_URL');
console.log(`Lubi: ${url}\nPassword remains in .env.local / your environment. Ctrl+C stops this service.`);
const child=spawn(process.execPath,['--import','tsx','apps/api/src/server.ts'],{cwd:root,env:process.env,stdio:'inherit'});
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;child.kill(signal);});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
if(process.argv.includes('--open')&&process.env.LUBI_NO_OPEN!=='1'){
  const timer=setInterval(async()=>{try{const response=await fetch(backend+'/api/health');if(!response.ok)return;clearInterval(timer);const [command,args]=process.platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];const opener=spawn(command,args,{stdio:'ignore',detached:true});opener.on('error',()=>{});opener.unref();}catch{}},500);timer.unref();child.once('exit',()=>clearInterval(timer));
}
const [code]=await once(child,'exit');process.exitCode=stopping?0:code||0;
