import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { startApp } from './support.mjs';

test('SQLite virtual Vault, host boundaries and conflict-safe persistence', {timeout:60000}, async t=>{
  const app=await startApp();
  const put=(path,text,expectedRevision=0,kind='file')=>app.json('/vault/file','PUT',{path,text,expectedRevision,kind});
  try {
    await t.test('anonymous reads and cross-origin writes are rejected',async()=>{
      assert.equal((await fetch(app.base+'/api/vault/snapshot')).status,401);
      assert.equal((await app.request('/vault/file','PUT',{path:'x.md',kind:'file',text:'x',expectedRevision:0},{origin:'https://untrusted.example'})).status,403);
    });
    await t.test('UTF-8, Markdown and unknown v14 fields round-trip byte-for-byte',async()=>{
      const original='# 合成日记\n\n## 手写笔记\n这一段必须原样保留。\n\n## 记录\n- 09:00 学习 · 验证 [时长:: 30min] [未知字段:: 原样]\n';
      const saved=await put('日记/2026-10-18.md',original);
      assert.equal(saved.text,original);assert.equal((await app.json('/vault/file?path='+encodeURIComponent(saved.path))).text,original);
      const model=JSON.stringify({version:14,tasks:[{id:'preserved',custom:{a:1,b:['字段']}}],unknownRoot:{future:true}});
      assert.equal((await put('任务/任务数据.json',model)).text,model);
      const snapshot=await app.json('/vault/snapshot');assert(snapshot.documents.some(d=>d.kind==='folder'&&d.path==='日记'));
    });
    await t.test('traversal, absolute paths, hidden files and file/folder conflicts fail closed',async()=>{
      for(const path of ['../secret','/absolute','E:/private','.env','a/../b','a\\b','a//b'])assert.equal((await app.request('/vault/file','PUT',{path,kind:'file',text:'blocked',expectedRevision:0})).status,400,path);
      const row=await put('conflict','original');
      assert.equal((await app.request('/vault/file','PUT',{path:'conflict',kind:'folder',text:'',expectedRevision:row.revision})).status,409);
      assert.equal((await app.request('/vault/file','PUT',{path:'conflict/child.md',kind:'file',text:'no',expectedRevision:0})).status,409);
      assert.equal((await app.json('/vault/file?path=conflict')).text,'original');
    });
    await t.test('parallel writers cannot silently overwrite one another',async()=>{
      const initial=await put('race.md','before');
      const responses=await Promise.all(['left','right'].map(text=>app.request('/vault/file','PUT',{path:'race.md',kind:'file',text,expectedRevision:initial.revision})));
      assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
      const winner=await app.json('/vault/file?path=race.md');assert(['left','right'].includes(winner.text));
      const changes=await app.json('/vault/changes?since='+initial.revision);assert(changes.documents.some(d=>d.path==='race.md'&&d.text===winner.text));
    });
    await t.test('settings are revision-checked; API keys never enter durable settings or exports',async()=>{
      const initial=await app.json('/vault/settings');
      const saved=await app.json('/vault/settings','PUT',{data:{aiApiKey:'synthetic-sensitive-key',taskFile:'任务/任务数据.json',journalFolder:'日记'},expectedRevision:initial.revision});
      assert.equal(saved.data.aiApiKey,'');
      assert.equal((await app.request('/vault/settings','PUT',{data:{},expectedRevision:initial.revision})).status,409);
      assert.equal((await app.request('/vault/settings','PUT',{data:{taskFile:'../private'},expectedRevision:saved.revision})).status,400);
      assert(!JSON.stringify(await app.json('/vault/export')).includes('synthetic-sensitive-key'));
    });
    await t.test('deletion requires the current version and stores a recoverable snapshot',async()=>{
      const row=await put('delete-me.md','restore me');
      assert.equal((await app.request('/vault/file','DELETE',{path:row.path,expectedRevision:row.revision-1})).status,409);
      const deleted=await app.json('/vault/file','DELETE',{path:row.path,expectedRevision:row.revision});assert.equal(deleted.deleted,1);
      assert.equal((await app.request('/vault/file?path=delete-me.md')).status,404);
      const check=new DatabaseSync(join(app.folder,'isolated.db'),{readOnly:true});const backup=check.prepare("SELECT snapshot FROM vault_backups WHERE reason='delete' ORDER BY id DESC").get();check.close();
      assert(JSON.parse(backup.snapshot).documents.some(d=>d.path==='delete-me.md'&&d.text==='restore me'));
      assert.equal((await put('delete-me.md','new version')).text,'new version');
    });
    await t.test('AI proxy accepts only a configured origin and does not follow redirects',async()=>{
      let received;
      const mock=createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{received={method:req.method,auth:req.headers.authorization,body};if(req.url==='/redirect'){res.writeHead(302,{location:'http://169.254.169.254/'});res.end();}else{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'synthetic'}}]}));}});});
      mock.listen(0,'127.0.0.1');await once(mock,'listening');
      try {
        const origin=`http://127.0.0.1:${mock.address().port}`;
        assert.equal((await app.request('/network/request','POST',{url:origin+'/v1/models'})).status,403);
        let settings=await app.json('/vault/settings');settings=await app.json('/vault/settings','PUT',{data:{...settings.data,aiEndpoint:origin+'/v1'},expectedRevision:settings.revision});
        const result=await app.json('/network/request','POST',{url:origin+'/v1/chat/completions',method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:'{"test":true}'});
        assert.equal(result.status,200);assert.equal(received.auth,'Bearer synthetic-only');assert.equal(received.body,'{"test":true}');
        assert.equal((await app.json('/network/request','POST',{url:origin+'/redirect'})).status,302);
        settings=await app.json('/vault/settings','PUT',{data:{...settings.data,aiEndpoint:'https://100.100.100.200/v1'},expectedRevision:settings.revision});
        assert.equal((await app.request('/network/request','POST',{url:'https://100.100.100.200/v1/models'})).status,403);
      } finally {await new Promise(resolve=>mock.close(resolve));}
    });
    await t.test('Web file backup restores atomically into a new directory only',async()=>{
      const before=await app.json('/vault/export');const preview=await app.json('/vault/restore/preview','POST',{snapshot:before});assert(preview.files>0);
      assert.equal((await app.request('/vault/restore','POST',{snapshot:before})).status,400);
      const restored=await app.json('/vault/restore','POST',{snapshot:before,confirmed:true});assert(restored.root.startsWith('Lubi-Web恢复/'));
      const after=await app.json('/vault/snapshot');for(const file of before.documents.filter(x=>x.kind==='file')){assert.equal(after.documents.find(x=>x.path===file.path).text,file.text);assert.equal(after.documents.find(x=>x.path===restored.root+'/'+file.path).text,file.text);}
      const count=after.documents.length;const invalid={...before,documents:[...before.documents,{path:'../escape',kind:'file',text:'blocked'}]};assert.equal((await app.request('/vault/restore','POST',{snapshot:invalid,confirmed:true})).status,400);assert.equal((await app.json('/vault/snapshot')).documents.length,count);
    });
    await t.test('login throttles repeated invalid attempts',async()=>{
      for(let i=0;i<10;i++)assert.equal((await app.request('/auth/login','POST',{password:'wrong-but-long-enough-password'})).status,401);
      assert.equal((await app.request('/auth/login','POST',{password:'wrong-but-long-enough-password'})).status,429);
    });
  } finally {await app.stop();}
});

test('legacy Web upgrade preserves originals, projects, recurrence and estimated snapshots', {timeout:30000}, async()=>{
  const app=await startApp();
  try {
    const project=await app.json('/projects','POST',{title:'合成迁移项目'});
    const task=await app.json('/tasks','POST',{title:'合成跨午夜任务',date:'2026-10-18',category:'学习',estimate:90,projectId:project.id,repeat:{kind:'weekly',days:[7]}});
    await app.json('/records','POST',{date:'2026-10-18',start:'23:45',minutes:45,title:task.title,taskId:task.id});
    const before=await app.json('/export');
    const result=await app.json('/vault/upgrade-legacy','POST');assert.equal(result.tasks,1);assert.equal(result.records,1);
    const after=await app.json('/export');delete before.exportedAt;delete after.exportedAt;assert.deepEqual(after,before);
    const snapshot=await app.json('/vault/snapshot');const store=JSON.parse(snapshot.documents.find(d=>d.path==='任务/任务数据.json').text);
    assert.equal(store.version,14);assert.equal(store.tasks[0].project,project.id);assert.deepEqual(store.tasks[0].repeat,{kind:'weekly',days:[7]});
    assert.match(snapshot.documents.find(d=>d.path==='日记/2026-10-18.md').text,/时长:: 15min/);
    assert.match(snapshot.documents.find(d=>d.path==='日记/2026-10-19.md').text,/时长:: 30min/);
    assert.match(snapshot.documents.find(d=>d.path==='日记/2026-10-18.md').text,/预计用时:: 1.5h/);
    assert.equal((await app.request('/vault/upgrade-legacy','POST')).status,409);
    assert.equal((await app.request('/tasks','POST',{title:'must not go into retired tables'})).status,409);
    assert.deepEqual((await app.json('/export')).tasks,after.tasks);
  } finally {await app.stop();}
});
