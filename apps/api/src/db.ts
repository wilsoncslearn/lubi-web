import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const file = resolve(process.env.LUBI_DB_PATH || './data/lubi.db');
mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT '', estimate INTEGER NOT NULL DEFAULT 0 CHECK(estimate >= 0),
 status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')), created TEXT NOT NULL, updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
 id TEXT PRIMARY KEY, date TEXT NOT NULL, start TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes >= 0),
 category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, taskId TEXT REFERENCES tasks(id) ON DELETE SET NULL,
 estimatedMinutes INTEGER CHECK(estimatedMinutes >= 0), created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);`);

// Non-destructive migration for databases created by the initial prototype.
db.exec("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL COLLATE NOCASE UNIQUE, created TEXT NOT NULL)");
const columns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
if (!columns.some(column => column.name === 'projectId')) db.exec('ALTER TABLE tasks ADD COLUMN projectId TEXT REFERENCES projects(id) ON DELETE RESTRICT');
db.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL COLLATE NOCASE UNIQUE, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(projectId);`);

// Additive columns preserve task rows from earlier Web prototypes.
const repeatColumns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
const additions = [
  ['repeatKind', "TEXT NOT NULL DEFAULT 'none'"],
  ['repeatDays', "TEXT NOT NULL DEFAULT '[]'"],
  ['doneDates', "TEXT NOT NULL DEFAULT '[]'"],
  ['skipDates', "TEXT NOT NULL DEFAULT '[]'"],
  ['startDate', "TEXT NOT NULL DEFAULT ''"],
  ['endDate', "TEXT NOT NULL DEFAULT ''"]
];
for (const [name, definition] of additions) {
  if (!repeatColumns.some(column => column.name === name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
}
