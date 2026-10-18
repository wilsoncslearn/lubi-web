import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const secret='synthetic-restore-password-strong';
async function startServer(dir,port) {
  const child=spawn(process.execPath,['--import','tsx','apps/api/src/server.ts'],{cwd:process.cwd(),env:{...process.env,LUBI_PASSWORD:secret,LUBI_DB_PATH:join(dir,'test.db'),HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}/api`;
  for(let i=0;i<60;i++) {try{if((await fetch(base+'/health')).ok) break;}catch{} await sleep(150);}
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:secret})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const call=(path,method='GET',body)=>fetch(base+path,{method,headers:{cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  return {child,base,call};
}
test('preview-gated Web snapshot restore is atomic and cannot overwrite data',{timeout:40000},async()=>{
  const dir1=mkdtempSync(join(tmpdir(),'lubi-src-')),dir2=mkdtempSync(join(tmpdir(),'lubi-dst-'));
  const port=46000+Math.floor(Math.random()*10000);
  let a,b;
  try {
    a=await startServer(dir1,port);
    const project=await (await a.call('/projects','POST',{title:'Sample'})).json();
    const task=await (await a.call('/tasks','POST',{title:'Work',projectId:project.id,date:'2026-10-18',estimate:90,repeat:{kind:'weekly',days:[7]}})).json();
    assert.equal((await a.call(`/tasks/${task.id}/occurrences/2026-10-18`,'PATCH',{done:true})).status,200);
    const record=await (await a.call('/records','POST',{date:'2026-10-18',start:'09:00',minutes:45,title:'Work',taskId:task.id})).json();
    const data=await (await a.call('/export')).json();
    assert.equal(data.records[0].estimatedMinutes,90);
    b=await startServer(dir2,port+1);
    const source = {format:'lubi-data',version:1,exportedAt:'2026-10-18T00:00:00Z',taskStore:{version:14,
      projects:[{id:'project-1',title:'Project',created:'2026-10-18'}],projectContainers:[],
      tasks:[{id:'task-1',title:'Task',category:'Work',parent:'parent-1',project:'project-1',date:'2026-10-18',start:'09:00',notes:'Private notes',estimate:60}]},
      records:[{date:'2026-10-18',start:'23:30',minutes:90,title:'Task',category:'Work',task:'task-1',amount:20,extra:{'待确认':'按计划'}}]};
    assert.equal((await fetch(b.base+'/obsidian/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(source)})).status,401);
    const sourceRes=await b.call('/obsidian/preview','POST',source);
    assert.equal(sourceRes.status,200);
    const sourcePreview=await sourceRes.json();
    assert.deepEqual(sourcePreview.counts,{projects:1,tasks:1,records:1,archivedContainers:0});
    assert.equal(sourcePreview.readyForDirectImport,false);
    for(const code of ['PARENT_HIERARCHY_NOT_MODELED','SCHEDULE_TIME_NOT_MODELED','NOTES_NOT_MODELED','EXPENSE_NOT_MODELED','EXTRA_FIELDS_OR_PENDING_NOT_MODELED','CROSSES_MIDNIGHT_NOT_MODELED'])
      assert.equal(sourcePreview.issues.some(issue=>issue.code===code),true,code);
    assert.equal((await (await b.call('/export')).json()).tasks.length,0);
    assert.equal((await b.call('/obsidian/preview','POST',{...source,taskStore:{...source.taskStore,version:13}})).status,400);

    const bad={...data,records:[{...data.records[0],taskId:'missing'}]};
    assert.equal((await b.call('/import/preview','POST',bad)).status,400);
    assert.equal((await (await b.call('/export')).json()).tasks.length,0);
    const duplicateTitle={...data,projects:[...data.projects,{id:'other-project',title:'Sample',created:'2026-10-18'}]};
    const duplicatePreview=await (await b.call('/import/preview','POST',duplicateTitle)).json();
    assert.equal((await b.call('/import/apply','POST',{data:duplicateTitle,digest:duplicatePreview.digest})).status,400);
    assert.equal((await (await b.call('/export')).json()).projects.length,0);
    const previewRes=await b.call('/import/preview','POST',data);
    assert.equal(previewRes.status,200);
    const preview=await previewRes.json();
    assert.equal(preview.targetEmpty,true);
    assert.deepEqual(preview.counts,{projects:1,tasks:1,records:1});
    assert.equal((await b.call('/import/apply','POST',{data:{...data,records:[]},digest:preview.digest})).status,409);
    assert.equal((await b.call('/import/apply','POST',{data,digest:preview.digest})).status,200);
    const restored=await (await b.call('/export')).json();
    assert.deepEqual(restored.projects,data.projects);
    assert.deepEqual(restored.tasks,data.tasks);
    assert.deepEqual(restored.records,data.records);
    assert.equal(restored.records[0].taskId,task.id);
    assert.equal(restored.records[0].estimatedMinutes,90);
    assert.equal((await b.call('/import/preview','POST',data)).status,200);
    assert.equal((await b.call('/import/apply','POST',{data,digest:preview.digest})).status,409);
    assert.equal((await (await b.call('/export')).json()).records.length,1);
    assert.equal((await fetch(b.base+'/import/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})).status,401);
  } finally {a?.child.kill();b?.child.kill();await sleep(350);rmSync(dir1,{recursive:true,force:true,maxRetries:10,retryDelay:100});rmSync(dir2,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
