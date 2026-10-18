import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startApp } from './support.mjs';

test('Online SQLite backup and verified isolated restore preserve all state without replacing active files',async()=>{
  const app=await startApp();
  try{
    await app.json('/vault/file','PUT',{path:'日记/合成.md',kind:'file',text:'# 合成测试\n必须逐字保留。\n',expectedRevision:0});await app.json('/secrets/backup-key','PUT',{value:'synthetic-key-for-backup-only'});
    const env={...process.env,LUBI_DB_PATH:join(app.folder,'isolated.db'),LUBI_KEY_PATH:join(app.folder,'isolated-credentials.key'),LUBI_SECRET_KEY:''};
    const run=(file,args)=>spawnSync(process.execPath,[file,...args],{cwd:process.cwd(),env,encoding:'utf8'});
    const source=join(app.folder,'backup'),dest=join(app.folder,'recovered');const result=run('scripts/backup.mjs',[source]);assert.equal(result.status,0,result.stderr);assert(existsSync(join(source,'lubi-credentials.key')));
    const recovered=run('scripts/restore-db.mjs',[source,dest]);assert.equal(recovered.status,0,recovered.stderr);assert.notEqual(run('scripts/restore-db.mjs',[source,dest]).status,0);
    const db=new DatabaseSync(join(dest,'lubi.db'),{readOnly:true});assert.equal(db.prepare('SELECT text FROM vault_documents WHERE kind=\'file\'').get().text,'# 合成测试\n必须逐字保留。\n');assert.equal(db.prepare('SELECT count(*) n FROM web_secrets').get().n,1);assert(db.prepare('SELECT count(*) n FROM web_sessions').get().n>0);db.close();
    assert.deepEqual(readFileSync(join(dest,'lubi-credentials.key')),readFileSync(env.LUBI_KEY_PATH));
    writeFileSync(join(source,'lubi.db'),'tampered synthetic backup');const invalid=join(app.folder,'invalid');assert.notEqual(run('scripts/restore-db.mjs',[source,invalid]).status,0);assert(!existsSync(invalid));assert.equal((await app.json('/vault/file?path='+encodeURIComponent('日记/合成.md'))).text,'# 合成测试\n必须逐字保留。\n');
  }finally{await app.stop();}
});
