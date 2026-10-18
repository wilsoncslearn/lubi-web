import { ensureConfigured, root } from './environment.mjs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
ensureConfigured();
const host=process.env.WEB_HOST||process.env.HOST||'127.0.0.1',port=process.env.WEB_PORT||'5173';
const env={...process.env,NODE_ENV:'development',LUBI_API_ORIGIN:`http://127.0.0.1:${process.env.PORT}`};
const children=[
  spawn(process.execPath,['--import','tsx','apps/api/src/server.ts'],{cwd:root,env,stdio:'inherit'}),
  spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host',host,'--port',port,'--strictPort'],{cwd:join(root,'apps/web'),env,stdio:'inherit'}),
];
console.log(`Lubi development workspace: http://${host==='0.0.0.0'?'127.0.0.1':host}:${port}`);
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
for(const child of children){child.on('error',e=>{console.error(e.message);stop(1);});child.on('exit',code=>{if(!stopping)stop(code||0);});}
