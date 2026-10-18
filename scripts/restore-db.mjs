import { root } from './environment.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, mkdirSync, copyFileSync, renameSync, rmSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
if(!process.argv[2])throw new Error('Usage: npm run restore:db -- BACKUP_DIRECTORY [NEW_DIRECTORY]. Existing data is never replaced.');
const source=resolve(process.argv[2]),manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));
if(manifest.format!=='lubi-sqlite-backup'||manifest.version!==1||!manifest.sha256?.['lubi.db'])throw new Error('Not a supported SQLite backup.');
const names=Object.keys(manifest.sha256);if(names.some(name=>!['lubi.db','lubi-credentials.key'].includes(name)))throw new Error('Unexpected backup file.');
const destination=resolve(process.argv[3]||join(root,'data','restored-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)));
if(existsSync(destination))throw new Error('Restore directory already exists. No existing file was modified.');
const stage=destination+'.pending-'+randomUUID();mkdirSync(stage,{recursive:true,mode:0o700});
try{
  for(const name of names){if(!lstatSync(join(source,name)).isFile())throw new Error('Backup must contain regular files only.');copyFileSync(join(source,name),join(stage,name));if(createHash('sha256').update(readFileSync(join(stage,name))).digest('hex')!==manifest.sha256[name])throw new Error('Backup checksum mismatch: '+name);}
  const db=new DatabaseSync(join(stage,'lubi.db'),{readOnly:true});let ok;try{ok=db.prepare('PRAGMA integrity_check').get();}finally{db.close();}if(Object.values(ok||{})[0]!=='ok')throw new Error('SQLite integrity check failed.');
  renameSync(stage,destination);console.log('Isolated restore completed: '+destination);console.log('Current database and .env.local were NOT changed. After inspection, set LUBI_DB_PATH to the restored lubi.db and restart.');console.log('If using LUBI_KEY_PATH, point it to the restored key file. External LUBI_SECRET_KEY must be supplied separately.');
}catch(error){rmSync(stage,{recursive:true,force:true});throw error;}
