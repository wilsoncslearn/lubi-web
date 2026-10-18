import type { FastifyInstance } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

/** A virtual Vault, not a path into the host filesystem. Source Vaults are never opened here. */
export type VaultDocument = { path: string; kind: 'file' | 'folder'; text: string; revision: number; mtime: number; deleted: number };
const fail = (error: string) => ({ error });
export function vaultPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f\\:]/.test(value)) throw new Error('Invalid virtual Vault path');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw new Error('Invalid virtual Vault path');
  return parts.join('/');
}
export function installVaultSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS vault_documents(path TEXT PRIMARY KEY,kind TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,mtime INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS vault_clock(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO vault_clock VALUES(1,0);
    CREATE TABLE IF NOT EXISTS vault_settings(id INTEGER PRIMARY KEY CHECK(id=1),text TEXT NOT NULL,revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO vault_settings VALUES(1,'{}',0);
    CREATE TABLE IF NOT EXISTS vault_backups(id INTEGER PRIMARY KEY AUTOINCREMENT,created INTEGER NOT NULL,reason TEXT NOT NULL,snapshot TEXT NOT NULL);`);
}
export const getSettings = (db: DatabaseSync): { data: Record<string, unknown>; revision: number } => {
  const row = db.prepare('SELECT text,revision FROM vault_settings WHERE id=1').get() as { text: string; revision: number };
  return { data: JSON.parse(row.text), revision: row.revision };
};
export function vaultSnapshot(db: DatabaseSync) {
  return { format: 'lubi-web-vault', version: 1, revision: (db.prepare('SELECT revision FROM vault_clock WHERE id=1').get() as { revision: number }).revision,
    documents: db.prepare('SELECT * FROM vault_documents WHERE deleted=0 ORDER BY path').all() as VaultDocument[] };
}
function saveBackup(db: DatabaseSync, reason: string) {
  db.prepare('INSERT INTO vault_backups(created,reason,snapshot) VALUES(?,?,?)').run(Date.now(), reason, JSON.stringify(vaultSnapshot(db)));
}
function nextRevision(db: DatabaseSync): number {
  return (db.prepare('UPDATE vault_clock SET revision=revision+1 WHERE id=1 RETURNING revision').get() as { revision: number }).revision;
}
export function registerVault(app: FastifyInstance, db: DatabaseSync): void {
  installVaultSchema(db);
  app.get('/api/vault/snapshot', async (_req, reply) => { reply.header('cache-control', 'no-store'); return vaultSnapshot(db); });
  app.get('/api/vault/changes', async (req, reply) => {
    const since = Number((req.query as { since?: string }).since || 0);
    if (!Number.isSafeInteger(since) || since < 0) return reply.code(400).send(fail('Invalid revision'));
    return { revision: (db.prepare('SELECT revision FROM vault_clock WHERE id=1').get() as { revision: number }).revision,
      documents: db.prepare('SELECT * FROM vault_documents WHERE revision>? ORDER BY revision').all(since) };
  });
  app.get('/api/vault/file', async (req, reply) => {
    let path: string; try { path = vaultPath((req.query as { path?: string }).path); } catch { return reply.code(400).send(fail('Invalid path')); }
    const row = db.prepare('SELECT * FROM vault_documents WHERE path=? AND deleted=0').get(path);
    return row || reply.code(404).send(fail('File not found'));
  });
  app.put('/api/vault/file', { schema: { body: { type: 'object', required: ['path','kind','text','expectedRevision'], additionalProperties: false,
    properties: { path: { type: 'string' }, kind: { enum: ['file','folder'] }, text: { type: 'string', maxLength: 4194304 }, expectedRevision: { type: 'integer', minimum: 0 } } } } }, async (req, reply) => {
    const body = req.body as { path: string; kind: 'file'|'folder'; text: string; expectedRevision: number };
    let path: string; try { path = vaultPath(body.path); } catch { return reply.code(400).send(fail('Invalid path')); }
    if(Buffer.byteLength(body.text)>4194304)return reply.code(413).send(fail('单个虚拟文件不能超过 4MiB。'));
    if (body.kind === 'folder' && body.text !== '') return reply.code(400).send(fail('Folders cannot contain text'));
    db.exec('BEGIN IMMEDIATE');
    try {
      const old = db.prepare('SELECT * FROM vault_documents WHERE path=? AND deleted=0').get(path) as VaultDocument | undefined;
      if ((old?.revision || 0) !== body.expectedRevision) { db.exec('ROLLBACK'); return reply.code(409).send(fail('文件已在其他窗口修改，请重新读取后再保存。')); }
      if (old && old.kind !== body.kind) { db.exec('ROLLBACK'); return reply.code(409).send(fail('Path type conflict')); }
      const parents = path.split('/').slice(0,-1);
      for (let i=1;i<=parents.length;i++) {
        const parent = parents.slice(0,i).join('/');
        const existing = db.prepare('SELECT kind FROM vault_documents WHERE path=? AND deleted=0').get(parent) as {kind:string}|undefined;
        if (existing?.kind === 'file') { db.exec('ROLLBACK');return reply.code(409).send(fail('父路径是文件，未修改任何文件。')); }
        if (!existing) db.prepare('INSERT OR REPLACE INTO vault_documents VALUES(?,?,?,?,?,0)').run(parent,'folder','',nextRevision(db),Date.now());
      }
      const row = {path,kind:body.kind,text:body.text,revision:nextRevision(db),mtime:Date.now(),deleted:0};
      db.prepare('INSERT OR REPLACE INTO vault_documents VALUES(@path,@kind,@text,@revision,@mtime,@deleted)').run(row);
      db.exec('COMMIT'); return row;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  app.delete('/api/vault/file', async (req, reply) => {
    const body = req.body as { path?: string; expectedRevision?: number } | undefined;
    let path: string; try { path = vaultPath(body?.path); } catch { return reply.code(400).send(fail('Invalid path')); }
    if (!Number.isSafeInteger(body?.expectedRevision)) return reply.code(400).send(fail('Expected revision required'));
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT * FROM vault_documents WHERE path=? AND deleted=0').get(path) as VaultDocument|undefined;
      if (!row) { db.exec('ROLLBACK'); return reply.code(404).send(fail('File not found')); }
      if (row.revision !== body!.expectedRevision) { db.exec('ROLLBACK'); return reply.code(409).send(fail('文件已变化，删除已取消。')); }
      if (row.kind === 'folder' && db.prepare('SELECT 1 FROM vault_documents WHERE substr(path,1,?)=? AND deleted=0 LIMIT 1').get(path.length+1,path+'/')) {
        db.exec('ROLLBACK'); return reply.code(409).send(fail('Only empty folders can be deleted'));
      }
      saveBackup(db, 'delete');
      const revision = nextRevision(db);
      db.prepare('UPDATE vault_documents SET deleted=1,revision=?,mtime=? WHERE path=?').run(revision,Date.now(),path);
      db.exec('COMMIT'); return { ...row, deleted:1, revision };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  app.get('/api/vault/settings', async (_req, reply) => { reply.header('cache-control','no-store'); return getSettings(db); });
  app.put('/api/vault/settings', async (req, reply) => {
    const body = req.body as { data?: Record<string,unknown>; expectedRevision?: number } | undefined;
    if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data) || !Number.isSafeInteger(body.expectedRevision)) return reply.code(400).send(fail('Invalid settings'));
    if (JSON.stringify(body.data).length > 262144) return reply.code(413).send(fail('Settings too large'));
    for (const name of ['taskFile','journalFolder','backupFolder']) if (body.data[name] !== undefined) {
      try { vaultPath(body.data[name]); } catch { return reply.code(400).send(fail('设置中的路径必须是独立 Web Vault 内的相对路径。')); }
    }
    const data = { ...body.data, aiApiKey:'' };
    const row = db.prepare('UPDATE vault_settings SET text=?,revision=revision+1 WHERE id=1 AND revision=? RETURNING revision').get(JSON.stringify(data),body.expectedRevision!) as {revision:number}|undefined;
    if (!row) return reply.code(409).send(fail('设置已在其他窗口修改，请刷新后重试。'));
    return { data, revision:row.revision };
  });
  app.get('/api/vault/export', async (_req, reply) => {
    reply.header('cache-control','no-store').header('content-disposition','attachment; filename="lubi-web-vault.json"');
    return { ...vaultSnapshot(db), exportedAt:new Date().toISOString() };
  });
  app.get('/api/vault/legacy-status', async () => ({
    projects: (db.prepare('SELECT count(*) n FROM projects').get() as {n:number}).n,
    tasks: (db.prepare('SELECT count(*) n FROM tasks').get() as {n:number}).n,
    records: (db.prepare('SELECT count(*) n FROM records').get() as {n:number}).n,
    targetEmpty: !db.prepare("SELECT 1 FROM vault_documents WHERE kind='file' AND deleted=0 LIMIT 1").get()
  }));
  // Explicit, atomic upgrade of the old Web tables; old tables are retained, never dropped.
  app.post('/api/vault/upgrade-legacy', async (_req, reply) => {
    if (db.prepare("SELECT 1 FROM vault_documents WHERE kind='file' AND deleted=0 LIMIT 1").get()) return reply.code(409).send(fail('新 Vault 已有文件，不覆盖。'));
    const { blankTask } = await import('../../../packages/plugin-runtime/src/core/tasks.js');
    const { serializeRecord } = await import('../../../packages/plugin-runtime/src/core/records.js');
    const { minToHM, hmToMin, shiftDate } = await import('../../../packages/plugin-runtime/src/core/time.js');
    db.exec('BEGIN IMMEDIATE');
    try {
      if(db.prepare("SELECT 1 FROM vault_documents WHERE kind='file' AND deleted=0 LIMIT 1").get()){db.exec('ROLLBACK');return reply.code(409).send(fail('新 Vault 已有文件，不覆盖。'));}
      const projects = db.prepare('SELECT * FROM projects ORDER BY created,id').all();
      const oldTasks = db.prepare('SELECT * FROM tasks ORDER BY created,id').all() as Record<string,any>[];
      const records = db.prepare('SELECT * FROM records ORDER BY date,start,id').all() as Record<string,any>[];
      const tasks = oldTasks.map(t => blankTask({ id:t.id,title:t.title,category:t.category,date:t.date,estimate:t.estimate,status:t.status,
        project:t.projectId || undefined,repeat:{kind:t.repeatKind,days:JSON.parse(t.repeatDays)},doneDates:JSON.parse(t.doneDates),skipDates:JSON.parse(t.skipDates),
        startDate:t.startDate,endDate:t.endDate,created:t.created,updated:t.updated,doneAt:t.status==='done'?t.updated:'' }));
      const byDay = new Map<string,string[]>();
      const append = (date:string, rec:any) => { const rows=byDay.get(date)||[];rows.push(serializeRecord(rec));byDay.set(date,rows); };
      for (const r of records) {
        const first = Math.min(r.minutes,1440-hmToMin(r.start));
        const extra: Record<string,string> = { 'Web原记录ID':r.id };
        const rec = { date:r.date,start:r.start,end:minToHM(hmToMin(r.start)+first),minutes:first,estimatedMinutes:r.estimatedMinutes ?? undefined,category:r.category,title:r.title,task:r.taskId||undefined,extra };
        append(r.date,rec);
        if (r.minutes>first) { const date=shiftDate(r.date,1);append(date,{...rec,date,start:'00:00',end:minToHM(r.minutes-first),minutes:r.minutes-first}); }
      }
      const oldSnapshot = { projects, tasks:oldTasks, records };
      db.prepare('INSERT INTO vault_backups(created,reason,snapshot) VALUES(?,?,?)').run(Date.now(),'legacy-web-upgrade',JSON.stringify(oldSnapshot));
      const write=(path:string,kind:string,text:string)=>db.prepare('INSERT INTO vault_documents VALUES(?,?,?,?,?,0)').run(path,kind,text,nextRevision(db),Date.now());
      write('任务','folder','');write('日记','folder','');
      write('任务/任务数据.json','file',JSON.stringify({version:14,tasks,projects},null,2)+'\n');
      for(const [date,rows] of byDay) write(`日记/${date}.md`,'file',`# ${date}\n\n## 记录\n\n${rows.join('\n')}\n`);
      db.exec('COMMIT'); return { ok:true, projects:projects.length,tasks:tasks.length,records:records.length,checksum:createHash('sha256').update(JSON.stringify(oldSnapshot)).digest('hex') };
    } catch(error) { db.exec('ROLLBACK');throw error; }
  });
}
