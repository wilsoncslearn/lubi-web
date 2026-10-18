import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isDate, isTime } from '@lubi/domain';

type Row = Record<string, unknown>;
type Snapshot = { format: 'lubi-web-data'; version: 1; exportedAt: string; projects: Row[]; tasks: Row[]; records: Row[] };
const projectKeys = ['id','title','created'];
const taskKeys = ['id','title','category','date','estimate','status','created','updated','projectId','repeatKind','repeatDays','doneDates','skipDates','startDate','endDate'];
const recordKeys = ['id','date','start','minutes','category','title','taskId','estimatedMinutes','created'];
const obj = (x: unknown): x is Row => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 2048): x is string => typeof x === 'string' && x.length <= max;
const id = (x: unknown): x is string => str(x,128) && x.length > 0;
const integer = (x: unknown, max: number): x is number => Number.isInteger(x) && typeof x === 'number' && x >= 0 && x <= max;
const dateOrBlank = (x: unknown) => x === '' || (typeof x === 'string' && isDate(x));
const exact = (row: Row, keys: string[]) => Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row,key));
const validDates = (raw: unknown) => {
  if (!str(raw,200000)) return false;
  try { const dates: unknown = JSON.parse(raw); return Array.isArray(dates) && dates.length <= 5000 && dates.every(x=>typeof x==='string' && isDate(x)) && new Set(dates).size === dates.length; }
  catch { return false; }
};
const validDays = (raw: unknown, kind: string) => {
  if (!str(raw,2000)) return false;
  try { const days: unknown = JSON.parse(raw); const max = kind === 'weekly' ? 7 : 31;
    return Array.isArray(days) && days.length <= 31 && days.every(x=>integer(x,max) && x >= 1) && new Set(days).size === days.length; }
  catch { return false; }
};
export function validateSnapshot(value: unknown): { data?: Snapshot; error?: string } {
  if (!obj(value) || value.format !== 'lubi-web-data' || value.version !== 1 || !str(value.exportedAt,100)) return {error:'Unsupported Web export format'};
  const {projects,tasks,records} = value;
  if (!Array.isArray(projects) || !Array.isArray(tasks) || !Array.isArray(records) || projects.length > 5000 || tasks.length > 10000 || records.length > 50000)
    return {error:'Missing or oversized data collections'};
  const ids = (rows: unknown[], keys: string[]) => rows.every(row=>obj(row) && exact(row,keys) && id(row.id)) && new Set(rows.map(row=>(row as Row).id)).size === rows.length;
  if (!ids(projects,projectKeys) || !ids(tasks,taskKeys) || !ids(records,recordKeys)) return {error:'Invalid fields or duplicate IDs'};
  if (!projects.every((p:Row)=>str(p.title,120) && p.title.length>0 && str(p.created,100))) return {error:'Invalid projects'};
  const projectIds = new Set(projects.map((p:Row)=>p.id)), taskIds = new Set(tasks.map((t:Row)=>t.id));
  for (const t of tasks as Row[]) {
    if (!str(t.title,200) || !t.title.trim() || !str(t.category,100) || !dateOrBlank(t.date) || !integer(t.estimate,100000) ||
        !['todo','doing','done'].includes(String(t.status)) || !str(t.created,100) || !str(t.updated,100) ||
        !(t.projectId === null || (id(t.projectId) && projectIds.has(t.projectId))) ||
        !['none','daily','weekly','monthly'].includes(String(t.repeatKind)) || !validDays(t.repeatDays,String(t.repeatKind)) ||
        !validDates(t.doneDates) || !validDates(t.skipDates) || !dateOrBlank(t.startDate) || !dateOrBlank(t.endDate)) return {error:'Invalid tasks or project links'};
  }
  for (const r of records as Row[]) {
    if (!isDate(String(r.date)) || !isTime(String(r.start)) || !integer(r.minutes,1440) || !str(r.category,100) ||
        !str(r.title,200) || !r.title.trim() || !(r.taskId === null || (id(r.taskId) && taskIds.has(r.taskId))) ||
        !(r.estimatedMinutes === null || integer(r.estimatedMinutes,100000)) || !str(r.created,100)) return {error:'Invalid records or task links'};
  }
  return { data:value as Snapshot };
}
export const snapshotDigest = (data: Snapshot): string => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function restoreIntoEmptyDatabase(db: DatabaseSync, data: Snapshot): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['projects','tasks','records']) {
      if ((db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) throw new Error('TARGET_NOT_EMPTY');
    }
    const project = db.prepare('INSERT INTO projects(id,title,created) VALUES (@id,@title,@created)');
    const task = db.prepare(`INSERT INTO tasks(id,title,category,date,estimate,status,created,updated,projectId,repeatKind,repeatDays,doneDates,skipDates,startDate,endDate)
      VALUES (@id,@title,@category,@date,@estimate,@status,@created,@updated,@projectId,@repeatKind,@repeatDays,@doneDates,@skipDates,@startDate,@endDate)`);
    const record = db.prepare(`INSERT INTO records(id,date,start,minutes,category,title,taskId,estimatedMinutes,created)
      VALUES (@id,@date,@start,@minutes,@category,@title,@taskId,@estimatedMinutes,@created)`);
    for (const row of data.projects) project.run(row as Record<string,string|number|null>);
    for (const row of data.tasks) task.run(row as Record<string,string|number|null>);
    for (const row of data.records) record.run(row as Record<string,string|number|null>);
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
