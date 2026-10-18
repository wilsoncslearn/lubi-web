import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute, join } from 'node:path';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
export const root=fileURLToPath(new URL('../',import.meta.url));
const inherited=new Set(Object.keys(process.env));
let loaded=false;
export function loadEnvironment(){
  if(Number(process.versions.node.split('.')[0])<24)throw new Error('Lubi requires Node.js 24 or newer.');
  if(loaded)return;loaded=true;
  for(const name of ['.env','.env.local']){const path=join(root,name);if(existsSync(path))for(const [key,value] of Object.entries(parseEnv(readFileSync(path,'utf8').replace(/^\uFEFF/,''))))if(!inherited.has(key))process.env[key]=value;}
  const explicit=process.env.LUBI_DB_PATH;
  if(explicit){if(!isAbsolute(explicit)){const current=resolve(root,explicit),old=resolve(root,'apps/api',explicit);if(current!==old&&existsSync(current)&&existsSync(old))throw new Error('Two existing databases match relative LUBI_DB_PATH. Set an absolute path; neither database was changed.');process.env.LUBI_DB_PATH=!existsSync(current)&&existsSync(old)?old:current;}}
  else{
    const current=join(root,'data/lubi.db'),old=join(root,'apps/api/data/lubi.db');
    if(existsSync(current)&&existsSync(old))throw new Error('Two existing databases found. Set an explicit LUBI_DB_PATH; no database was selected or changed.');
    process.env.LUBI_DB_PATH=existsSync(old)?old:current;
  }
  if(process.env.LUBI_KEY_PATH&&!isAbsolute(process.env.LUBI_KEY_PATH))process.env.LUBI_KEY_PATH=resolve(root,process.env.LUBI_KEY_PATH);
  process.env.HOST??='127.0.0.1';process.env.PORT??='3000';
}
export function ensureConfigured(){
  loadEnvironment();const password=process.env.LUBI_PASSWORD;
  if(password&&password.length>=16&&password.length<=1024&&password!=='replace-with-a-long-unique-password')return;
  if(inherited.has('LUBI_PASSWORD') || (password&&password!=='replace-with-a-long-unique-password'))throw new Error('LUBI_PASSWORD must contain 16–1024 characters. Existing configuration was not overwritten.');
  const file=join(root,'.env.local');
  if(existsSync(file)&&Object.hasOwn(parseEnv(readFileSync(file,'utf8')),'LUBI_PASSWORD'))throw new Error('Please replace the placeholder LUBI_PASSWORD in .env.local. Existing configuration was not overwritten.');
  const generated=randomBytes(32).toString('base64url');
  const content=`\n# Local-only access secret; never commit or share this file.\nLUBI_PASSWORD=${generated}\n`;
  if(existsSync(file))appendFileSync(file,content);else writeFileSync(file,'# Generated for this installation. Environment variables take precedence.\n'+content,{flag:'wx',mode:0o600});
  process.env.LUBI_PASSWORD=generated;
  console.log('Created a unique local access password in .env.local (not printed).');
}
loadEnvironment();
