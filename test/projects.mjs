import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('project ownership, protected API and non-destructive deletion', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lubi-api-'));
  const port = 32000 + Math.floor(Math.random() * 10000);
  const legacy = new DatabaseSync(join(dir, 'test.db'));
  legacy.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,date TEXT NOT NULL,estimate INTEGER NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL); INSERT INTO tasks VALUES ('legacy-1','Existing task','','',0,'todo','2026-01-01','2026-01-01')");
  legacy.close();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts'], {
    cwd: process.cwd(), env: { ...process.env, LUBI_PASSWORD: 'integration-test-only-long-secret', LUBI_DB_PATH: join(dir, 'test.db'), PORT: String(port), HOST: '127.0.0.1', LUBI_DEV_ORIGINS: 'http://127.0.0.1:5173' }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}/api`;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { ready = (await fetch(`${base}/health`)).ok; if (ready) break; } catch {} await delay(150); }
    assert.equal(ready, true, 'API started');
    assert.equal((await fetch(`${base}/projects`)).status, 401);
    assert.equal((await fetch(`${base}/auth/login`,{method:'POST',headers:{'origin':'http://evil.example','content-type':'application/json'},body:JSON.stringify({password:'integration-test-only-long-secret'})})).status,403);
    assert.equal((await fetch(`${base}/auth/login`,{method:'POST',headers:{'origin':'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({password:'integration-test-only-long-secret'})})).status,200);
    assert.equal((await fetch(`${base}/export`)).status, 401);
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ password: 'integration-test-only-long-secret' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const call = (path, method='GET', body) => fetch(base+path, { method, headers: { cookie, ...(body ? {'content-type':'application/json'} : {}) }, body: body ? JSON.stringify(body) : undefined });
    const prior = await (await call('/tasks')).json();
    assert.equal(prior.find(t => t.id === 'legacy-1')?.projectId, null);
    const projectRes = await call('/projects','POST',{ title:'Synthetic project' });
    assert.equal(projectRes.status, 201);
    const project = await projectRes.json();
    const taskRes = await call('/tasks','POST',{ title:'Synthetic task', date:'2026-10-18', projectId:project.id });
    assert.equal(taskRes.status, 201);
    const task = await taskRes.json();
    assert.equal(task.projectId, project.id);
    assert.equal((await call(`/projects/${project.id}`,'DELETE')).status, 409);
    assert.equal((await call(`/tasks/${task.id}`,'PATCH',{projectId:null})).status, 200);
    assert.equal((await call(`/projects/${project.id}`,'DELETE')).status, 204);
    assert.equal((await call('/tasks','POST',{title:'Bad link',projectId:'does-not-exist'})).status, 400);
    const recurring = await call('/tasks','POST',{title:'Daily review',date:'2026-10-18',repeat:{kind:'daily',days:[]}});
    assert.equal(recurring.status, 201);
    const repeated = await recurring.json();
    assert.equal((await (await call('/tasks?date=2026-10-19')).json()).some(t=>t.id===repeated.id),true);
    assert.equal((await call(`/tasks/${repeated.id}/occurrences/2026-10-19`,'PATCH',{done:true})).status,200);
    const on19 = (await (await call('/tasks?date=2026-10-19')).json()).find(t=>t.id===repeated.id);
    const on20 = (await (await call('/tasks?date=2026-10-20')).json()).find(t=>t.id===repeated.id);
    assert.equal(on19.occurrenceDone,true); assert.equal(on20.occurrenceDone,false);
    assert.equal((await call(`/tasks/${repeated.id}/occurrences/2026-10-20`,'PATCH',{skip:true})).status,200);
    assert.equal((await (await call('/tasks?date=2026-10-20')).json()).some(t=>t.id===repeated.id),false);
    assert.equal((await call(`/tasks/${repeated.id}/occurrences/2026-10-20`,'PATCH',{done:true})).status,400);
    assert.equal((await call(`/tasks/${repeated.id}/occurrences/2026-10-20`,'PATCH',{skip:false})).status,200);
    assert.equal((await (await call('/tasks?date=2026-10-20')).json()).some(t=>t.id===repeated.id),true);
    assert.equal((await call('/tasks','POST',{title:'Invalid weekly',date:'2026-10-18',repeat:{kind:'weekly',days:[8]}})).status,400);
    const linked = await (await call('/tasks','POST',{title:'Study',category:'Learning',date:'2026-10-18',estimate:90})).json();
    const recordInput = {date:'2026-10-18',start:'09:00',minutes:30,title:'Study',taskId:linked.id};
    const first = await (await call('/records','POST',recordInput)).json();
    assert.equal(first.estimatedMinutes,90);
    assert.equal(first.category,'Learning');
    assert.equal((await call(`/tasks/${linked.id}`,'PATCH',{estimate:120})).status,200);
    const second = await (await call('/records','POST',{...recordInput,start:'10:00',minutes:20})).json();
    assert.equal(second.estimatedMinutes,120);
    const stored = await (await call('/records?date=2026-10-18')).json();
    assert.equal(stored.find(r=>r.id===first.id)?.estimatedMinutes,90);
    assert.equal((await (await call('/records','POST',{...recordInput,estimatedMinutes:999})).json()).estimatedMinutes,120);
    const standalone = await (await call('/records','POST',{date:'2026-10-18',start:'11:00',minutes:10,title:'Independent'})).json();
    assert.equal(standalone.estimatedMinutes,null);
    assert.equal((await (await call('/summary?date=2026-10-18')).json()).actualMinutes,90);
    assert.equal((await call(`/tasks/${linked.id}`,'DELETE')).status,409);
    const revision = await call(`/records/${first.id}`,'PATCH',{title:'Revised study',start:'08:45',minutes:40});
    assert.equal(revision.status,200);
    const revised = await revision.json();
    assert.equal(revised.estimatedMinutes,90);
    assert.equal(revised.taskId,linked.id);
    assert.equal(revised.title,'Revised study');
    assert.equal((await call(`/records/${first.id}`,'PATCH',{date:'2026-02-30'})).status,400);
    assert.equal((await (await call('/summary?date=2026-10-18')).json()).actualMinutes,100);
    assert.equal((await (await call('/records?date=2026-10-18')).json()).find(r=>r.id===first.id)?.estimatedMinutes,90);
    const reviewRes = await call('/review?from=2026-10-12&to=2026-10-18');
    assert.equal(reviewRes.status,200);
    const review = await reviewRes.json();
    assert.equal(review.recordedMinutes,100);
    assert.equal(review.coveredMinutes,75);
    assert.equal(review.days.find(d=>d.date==='2026-10-18').overlapMinutes,25);
    assert.equal(review.categories.find(c=>c.name==='Learning').minutes,90);
    assert.equal((await call('/review?from=2026-10-19&to=2026-10-18')).status,400);
    assert.equal((await call('/review?from=2025-01-01&to=2026-10-18')).status,400);
    const exportRes = await call('/export');
    assert.equal(exportRes.status,200);
    assert.match(exportRes.headers.get('content-disposition'),/attachment/);
    assert.equal(exportRes.headers.get('cache-control'),'no-store');
    const exported = await exportRes.json();
    assert.equal(exported.format,'lubi-web-data');
    assert.equal(exported.version,1);
    assert.equal(exported.projects.length,0);
    assert.equal(exported.tasks.find(t=>t.id===linked.id)?.estimate,120);
    assert.equal(exported.records.find(r=>r.id===first.id)?.estimatedMinutes,90);
    assert.equal(exported.records.length,4);
    assert.equal(JSON.stringify(exported).includes('integration-test-only-long-secret'),false);




  } finally { child.kill(); await delay(300); rmSync(dir, {recursive:true,force:true,maxRetries:10,retryDelay:100}); }
});
