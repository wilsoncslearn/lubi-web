import { root } from './environment.mjs';
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const source=process.env.LUBI_DB_PATH;
if(!existsSync(source))throw new Error('Configured database does not exist; nothing was backed up.');
const destination=resolve(process.argv[2]||join(root,'backups','lubi-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)));
if(existsSync(destination))throw new Error('Backup destination already exists; it was not overwritten.');
const stage=destination+'.pending-'+randomUUID();mkdirSync(stage,{recursive:true,mode:0o700});
let db;
try{
  db=new DatabaseSync(source,{readOnly:true});await backup(db,join(stage,'lubi.db'));db.close();db=undefined;
  const copy=new DatabaseSync(join(stage,'lubi.db'),{readOnly:true});const hasSecrets=!!copy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_secrets'").get()&&!!copy.prepare('SELECT 1 FROM web_secrets LIMIT 1').get();copy.close();
  const key=process.env.LUBI_KEY_PATH||join(dirname(source),'lubi-credentials.key');
  const files=['lubi.db'];
  if(!process.env.LUBI_SECRET_KEY&&existsSync(key)){copyFileSync(key,join(stage,'lubi-credentials.key'));files.push('lubi-credentials.key');}
  else if(hasSecrets&&!process.env.LUBI_SECRET_KEY)throw new Error('Named secrets exist but their key file is missing. The incomplete backup was discarded.');
  const hashes=Object.fromEntries(files.map(name=>[name,createHash('sha256').update(readFileSync(join(stage,name))).digest('hex')]));
  writeFileSync(join(stage,'manifest.json'),JSON.stringify({format:'lubi-sqlite-backup',version:1,created:new Date().toISOString(),keys:process.env.LUBI_SECRET_KEY?'external LUBI_SECRET_KEY; not included':files.includes('lubi-credentials.key')?'included local key; keep this entire backup private':'no stored secrets',sha256:hashes},null,2)+'\n',{mode:0o600});
  renameSync(stage,destination);console.log('Consistent SQLite backup completed: '+destination);console.log('Contains private data and, when present, the local encryption key. Do not publish or commit it.');
}catch(error){db?.close();rmSync(stage,{recursive:true,force:true});throw error;}
