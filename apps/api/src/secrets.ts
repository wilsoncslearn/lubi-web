import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keyFile = () => resolve(process.env.LUBI_KEY_PATH || join(dirname(resolve(process.env.LUBI_DB_PATH || fileURLToPath(new URL('../../../data/lubi.db',import.meta.url)))),'lubi-credentials.key'));
function masterKey(create=false):Buffer {
  if(process.env.LUBI_SECRET_KEY){const key=Buffer.from(process.env.LUBI_SECRET_KEY,'base64');if(key.length!==32)throw new Error('LUBI_SECRET_KEY must be a base64 32-byte key');return key;}
  const file=keyFile();
  try { const key=readFileSync(file);if(key.length!==32)throw new Error('Invalid credential key');return key; }
  catch(error){if(!create || (error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('本地密钥文件不可用；未尝试重建已有密钥。');}
  mkdirSync(dirname(file),{recursive:true});const key=randomBytes(32);
  try{writeFileSync(file,key,{flag:'wx',mode:0o600});return key;}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return masterKey();throw error;}
}
export function readSecret(db:DatabaseSync,name:string):string {
  const row=db.prepare('SELECT nonce,tag,ciphertext FROM web_secrets WHERE name=?').get(name) as {nonce:string;tag:string;ciphertext:string}|undefined;
  if(!row)throw new Error('选中的密钥不存在，请重新选择。');
  const decipher=createDecipheriv('aes-256-gcm',masterKey(),Buffer.from(row.nonce,'base64'));decipher.setAuthTag(Buffer.from(row.tag,'base64'));decipher.setAAD(Buffer.from(name));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext,'base64')),decipher.final()]).toString('utf8');
}
export function registerSecrets(app:FastifyInstance,db:DatabaseSync):void {
  db.exec('CREATE TABLE IF NOT EXISTS web_secrets(name TEXT PRIMARY KEY,nonce TEXT NOT NULL,tag TEXT NOT NULL,ciphertext TEXT NOT NULL)');
  app.get('/api/secrets',async()=>({names:(db.prepare('SELECT name FROM web_secrets ORDER BY name').all() as {name:string}[]).map(x=>x.name)}));
  app.put('/api/secrets/:name',async(req,reply)=>{
    const name=(req.params as {name:string}).name,value=(req.body as {value?:unknown})?.value;
    if(!/^[a-z0-9-]{1,64}$/.test(name)||typeof value!=='string'||!value.trim()||value.length>4096)return reply.code(400).send({error:'密钥名限小写字母、数字和连字符；密钥不能为空。'});
    if(db.prepare('SELECT 1 FROM web_secrets WHERE name=?').get(name))return reply.code(409).send({error:'密钥名称已存在，未覆盖。'});
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',masterKey(!db.prepare('SELECT 1 FROM web_secrets LIMIT 1').get()),nonce);cipher.setAAD(Buffer.from(name));
    const ciphertext=Buffer.concat([cipher.update(value.trim(),'utf8'),cipher.final()]);
    db.prepare('INSERT OR REPLACE INTO web_secrets VALUES(?,?,?,?)').run(name,nonce.toString('base64'),cipher.getAuthTag().toString('base64'),ciphertext.toString('base64'));
    return {ok:true,name};
  });
  app.delete('/api/secrets/:name',async(req,reply)=>{const name=(req.params as {name:string}).name;if(!/^[a-z0-9-]{1,64}$/.test(name))return reply.code(400).send({error:'Invalid key name'});db.prepare('DELETE FROM web_secrets WHERE name=?').run(name);return{ok:true};});
}
