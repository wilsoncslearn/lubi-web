import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  restoreIntoEmptyDatabase,
  snapshotDigest,
  validateSnapshot,
} from "./import.js";
import { previewObsidianExport } from "./obsidianPreview.js";
import {
  actualMinutes,
  dayTimeStats,
  doneOn,
  occursOn,
  isDate,
  isTime,
  type Project,
  type RepeatKind,
  type Task,
  type TimeRecord,
} from "@lubi/legacy-domain";

export interface LegacyImportPreview {
  digest: string;
  expires: number;
}
export const legacyReadOnlyMessage =
  "完整模式已启用。旧版 API 仅供只读导出；请通过新界面或 Vault API 修改，避免写入不再显示的旧表。";

// Called AFTER authentication on the root request hook. This is not a new write path.
export function legacyWriteBlocked(
  method: string,
  route: string,
  db: DatabaseSync,
) {
  return (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    /^\/api\/(?:projects|tasks|records|import)(?:\/|\?|$)/.test(route) &&
    !!db
      .prepare(
        "SELECT 1 FROM vault_documents WHERE kind='file' AND deleted=0 LIMIT 1",
      )
      .get()
  );
}

// Register on the same root Fastify instance so the existing auth hooks cover every route.
// These handlers intentionally preserve the old URLs, schemas and SQL behavior.
export function registerLegacyRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  session: (req: { headers: { cookie?: string } }) => string | undefined,
  importPreviews: Map<string, LegacyImportPreview>,
) {
  const text = (v: unknown, max = 200): string =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const fail = (message: string) => ({ error: message });
  app.get("/api/projects", async () =>
    db.prepare("SELECT * FROM projects ORDER BY created,id").all(),
  );
  app.post(
    "/api/projects",
    {
      schema: {
        body: {
          type: "object",
          required: ["title"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 120 },
          },
        },
      },
    },
    async (req, reply) => {
      const title = text((req.body as { title: string }).title, 120);
      if (!title) return reply.code(400).send(fail("Title required"));
      if (db.prepare("SELECT id FROM projects WHERE title=?").get(title))
        return reply.code(409).send(fail("Project already exists"));
      const project: Project = {
        id: randomUUID(),
        title,
        created: new Date().toISOString(),
      };
      db.prepare("INSERT INTO projects VALUES (@id,@title,@created)").run({
        ...project,
      });
      return reply.code(201).send(project);
    },
  );
  app.patch(
    "/api/projects/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["title"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 120 },
          },
        },
      },
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id,
        title = text((req.body as { title: string }).title, 120);
      if (!title) return reply.code(400).send(fail("Title required"));
      if (!db.prepare("SELECT id FROM projects WHERE id=?").get(id))
        return reply.code(404).send(fail("Project not found"));
      if (
        db
          .prepare("SELECT id FROM projects WHERE title=? AND id<>?")
          .get(title, id)
      )
        return reply.code(409).send(fail("Project already exists"));
      db.prepare("UPDATE projects SET title=? WHERE id=?").run(title, id);
      return db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    },
  );
  app.delete("/api/projects/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!db.prepare("SELECT id FROM projects WHERE id=?").get(id))
      return reply.code(404).send(fail("Project not found"));
    if (db.prepare("SELECT id FROM tasks WHERE projectId=? LIMIT 1").get(id))
      return reply.code(409).send(fail("Move project tasks before deleting"));
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
    return reply.code(204).send();
  });
  type TaskRow = Omit<Task, "repeat" | "doneDates" | "skipDates"> & {
    repeatKind: RepeatKind;
    repeatDays: string;
    doneDates: string;
    skipDates: string;
  };
  function hydrate(row: TaskRow): Task {
    return {
      ...row,
      repeat: {
        kind: row.repeatKind,
        days: JSON.parse(row.repeatDays) as number[],
      },
      doneDates: JSON.parse(row.doneDates) as string[],
      skipDates: JSON.parse(row.skipDates) as string[],
    };
  }
  const getTask = (id: string): Task | undefined => {
    const row = db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as
      | TaskRow
      | undefined;
    return row && hydrate(row);
  };
  function taskParams(t: Task) {
    return {
      id: t.id,
      title: t.title,
      category: t.category,
      date: t.date,
      estimate: t.estimate,
      status: t.status,
      created: t.created,
      updated: t.updated,
      projectId: t.projectId,
      repeatKind: t.repeat.kind,
      repeatDays: JSON.stringify(t.repeat.days),
      doneDates: JSON.stringify(t.doneDates),
      skipDates: JSON.stringify(t.skipDates),
      startDate: t.startDate,
      endDate: t.endDate,
    };
  }
  app.get("/api/tasks", async (req, reply) => {
    const date = (req.query as { date?: string }).date;
    if (date && !isDate(date))
      return reply.code(400).send(fail("Invalid date"));
    const all = (
      db
        .prepare("SELECT * FROM tasks ORDER BY date, created DESC")
        .all() as unknown as TaskRow[]
    ).map(hydrate);
    return date
      ? all
          .filter((t) => occursOn(t, date))
          .map((t) => ({ ...t, occurrenceDone: doneOn(t, date) }))
      : all;
  });
  app.patch(
    "/api/tasks/:id/occurrences/:date",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { done: { type: "boolean" }, skip: { type: "boolean" } },
          minProperties: 1,
        },
      },
    },
    async (req, reply) => {
      const { id, date } = req.params as { id: string; date: string };
      const value = req.body as { done?: boolean; skip?: boolean };
      const task = getTask(id);
      if (!task) return reply.code(404).send(fail("Task not found"));
      if (!isDate(date) || task.repeat.kind === "none")
        return reply
          .code(400)
          .send(fail("Recurring task and valid occurrence date required"));
      // A skipped occurrence remains addressable for unskip, but cannot be completed while skipped.
      if (!occursOn({ ...task, skipDates: [] }, date))
        return reply.code(400).send(fail("Date does not match repeat rule"));
      if (
        value.done === true &&
        (value.skip === true ||
          (task.skipDates.includes(date) && value.skip !== false))
      )
        return reply.code(400).send(fail("Unskip before completing"));
      if (value.done !== undefined)
        task.doneDates = value.done
          ? [...new Set([...task.doneDates, date])].sort()
          : task.doneDates.filter((d) => d !== date);
      if (value.skip !== undefined) {
        task.skipDates = value.skip
          ? [...new Set([...task.skipDates, date])].sort()
          : task.skipDates.filter((d) => d !== date);
        if (value.skip)
          task.doneDates = task.doneDates.filter((d) => d !== date);
      }
      task.updated = new Date().toISOString();
      db.prepare(
        "UPDATE tasks SET doneDates=@doneDates,skipDates=@skipDates,updated=@updated WHERE id=@id",
      ).run({
        id,
        doneDates: JSON.stringify(task.doneDates),
        skipDates: JSON.stringify(task.skipDates),
        updated: task.updated,
      });
      return task;
    },
  );
  app.post(
    "/api/tasks",
    {
      schema: {
        body: {
          type: "object",
          required: ["title"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            category: { type: "string", maxLength: 100 },
            date: { type: "string" },
            estimate: { type: "integer", minimum: 0, maximum: 100000 },
            status: { enum: ["todo", "doing", "done"] },
            projectId: { type: ["string", "null"] },
            repeat: {
              type: "object",
              required: ["kind", "days"],
              additionalProperties: false,
              properties: {
                kind: { enum: ["none", "daily", "weekly", "monthly"] },
                days: {
                  type: "array",
                  maxItems: 31,
                  items: { type: "integer", minimum: 1, maximum: 31 },
                  uniqueItems: true,
                },
              },
            },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const v = req.body as Partial<Task>;
      const date = v.date || "";
      const repeat = v.repeat ?? { kind: "none" as const, days: [] };
      if (repeat.kind === "weekly" && repeat.days.some((day) => day > 7))
        return reply.code(400).send(fail("Invalid weekday"));
      if (
        repeat.kind !== "none" &&
        (!date || (repeat.kind !== "daily" && !repeat.days.length))
      )
        return reply.code(400).send(fail("Repeat needs a date and valid days"));
      if (
        (v.startDate && !isDate(v.startDate)) ||
        (v.endDate && !isDate(v.endDate))
      )
        return reply.code(400).send(fail("Invalid range"));
      if (v.endDate && v.endDate < (v.startDate || date))
        return reply.code(400).send(fail("End before start"));
      if (date && !isDate(date))
        return reply.code(400).send(fail("Invalid date"));
      if (
        v.projectId &&
        !db.prepare("SELECT id FROM projects WHERE id=?").get(v.projectId)
      )
        return reply.code(400).send(fail("Project not found"));
      const now = new Date().toISOString();
      const task: Task = {
        repeat,
        doneDates: [],
        skipDates: [],
        startDate: repeat.kind === "none" ? "" : v.startDate || date,
        endDate: v.endDate || "",
        projectId: v.projectId || null,
        id: randomUUID(),
        title: v.title!.trim(),
        category: text(v.category, 100),
        date,
        estimate: v.estimate ?? 0,
        status: v.status ?? "todo",
        created: now,
        updated: now,
      };
      if (!task.title) return reply.code(400).send(fail("Title required"));
      db.prepare(
        "INSERT INTO tasks (id,title,category,date,estimate,status,created,updated,projectId,repeatKind,repeatDays,doneDates,skipDates,startDate,endDate) VALUES (@id,@title,@category,@date,@estimate,@status,@created,@updated,@projectId,@repeatKind,@repeatDays,@doneDates,@skipDates,@startDate,@endDate)",
      ).run(taskParams(task));
      return reply.code(201).send(task);
    },
  );
  app.patch(
    "/api/tasks/:id",
    {
      schema: {
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            category: { type: "string", maxLength: 100 },
            date: { type: "string" },
            estimate: { type: "integer", minimum: 0, maximum: 100000 },
            status: { enum: ["todo", "doing", "done"] },
            projectId: { type: ["string", "null"] },
            repeat: {
              type: "object",
              required: ["kind", "days"],
              additionalProperties: false,
              properties: {
                kind: { enum: ["none", "daily", "weekly", "monthly"] },
                days: {
                  type: "array",
                  maxItems: 31,
                  items: { type: "integer", minimum: 1, maximum: 31 },
                  uniqueItems: true,
                },
              },
            },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const old = getTask(id);
      if (!old) return reply.code(404).send(fail("Task not found"));
      const v = req.body as Partial<Task>;
      if (v.date && !isDate(v.date))
        return reply.code(400).send(fail("Invalid date"));
      if (
        v.projectId &&
        !db.prepare("SELECT id FROM projects WHERE id=?").get(v.projectId)
      )
        return reply.code(400).send(fail("Project not found"));
      if (v.repeat || v.startDate !== undefined || v.endDate !== undefined)
        return reply
          .code(400)
          .send(fail("Edit repeat rule is not supported yet"));
      if (
        old.repeat.kind !== "none" &&
        ((v.date !== undefined && v.date !== old.date) ||
          (v.status !== undefined && v.status !== old.status))
      )
        return reply
          .code(400)
          .send(
            fail(
              "Use occurrence endpoint for recurring task status; schedule edits are not supported",
            ),
          );
      const task = {
        ...old,
        ...v,
        title: v.title?.trim() ?? old.title,
        updated: new Date().toISOString(),
      };
      if (!task.title) return reply.code(400).send(fail("Title required"));
      db.prepare(
        "UPDATE tasks SET title=@title,category=@category,date=@date,estimate=@estimate,status=@status,updated=@updated,projectId=@projectId WHERE id=@id",
      ).run({
        id: task.id,
        title: task.title,
        category: task.category,
        date: task.date,
        estimate: task.estimate,
        status: task.status,
        updated: task.updated,
        projectId: task.projectId,
      });
      return task;
    },
  );
  app.delete("/api/tasks/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!getTask(id)) return reply.code(404).send(fail("Task not found"));
    if (db.prepare("SELECT id FROM records WHERE taskId=? LIMIT 1").get(id))
      return reply
        .code(409)
        .send(
          fail("Task has linked time records; remove or migrate records first"),
        );
    db.prepare("DELETE FROM tasks WHERE id=?").run(id);
    return reply.code(204).send();
  });
  app.get("/api/records", async (req, reply) => {
    const { date } = req.query as { date?: string };
    if (date && !isDate(date))
      return reply.code(400).send(fail("Invalid date"));
    return date
      ? db
          .prepare("SELECT * FROM records WHERE date=? ORDER BY start,id")
          .all(date)
      : db
          .prepare(
            "SELECT * FROM records ORDER BY date DESC,start DESC LIMIT 500",
          )
          .all();
  });
  app.post(
    "/api/records",
    {
      schema: {
        body: {
          type: "object",
          required: ["date", "start", "minutes", "title"],
          additionalProperties: false,
          properties: {
            date: { type: "string" },
            start: { type: "string" },
            minutes: { type: "integer", minimum: 0, maximum: 1440 },
            category: { type: "string", maxLength: 100 },
            title: { type: "string", minLength: 1, maxLength: 200 },
            taskId: { type: ["string", "null"] },
          },
        },
      },
    },
    async (req, reply) => {
      const v = req.body as Partial<TimeRecord>;
      if (!isDate(v.date!) || !isTime(v.start!))
        return reply.code(400).send(fail("Invalid date or time"));
      const linkedTask = v.taskId ? getTask(v.taskId) : undefined;
      if (v.taskId && !linkedTask)
        return reply.code(400).send(fail("Task not found"));
      const rec: TimeRecord = {
        id: randomUUID(),
        date: v.date!,
        start: v.start!,
        minutes: v.minutes!,
        category: text(v.category, 100) || linkedTask?.category || "",
        title: v.title!.trim(),
        taskId: v.taskId || null,
        estimatedMinutes: linkedTask ? linkedTask.estimate : null,
        created: new Date().toISOString(),
      };
      if (!rec.title) return reply.code(400).send(fail("Title required"));
      db.prepare(
        "INSERT INTO records VALUES (@id,@date,@start,@minutes,@category,@title,@taskId,@estimatedMinutes,@created)",
      ).run({ ...rec });
      return reply.code(201).send(rec);
    },
  );
  app.patch(
    "/api/records/:id",
    {
      schema: {
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            category: { type: "string", maxLength: 100 },
            date: { type: "string" },
            start: { type: "string" },
            minutes: { type: "integer", minimum: 0, maximum: 1440 },
          },
        },
      },
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const old = db
        .prepare("SELECT * FROM records WHERE id=?")
        .get(id) as unknown as TimeRecord | undefined;
      if (!old) return reply.code(404).send(fail("Record not found"));
      const v = req.body as Partial<TimeRecord>;
      if (v.date !== undefined && !isDate(v.date))
        return reply.code(400).send(fail("Invalid date"));
      if (v.start !== undefined && !isTime(v.start))
        return reply.code(400).send(fail("Invalid time"));
      const revised = {
        ...old,
        ...v,
        title: v.title?.trim() ?? old.title,
        category: v.category?.trim() ?? old.category,
      };
      if (!revised.title) return reply.code(400).send(fail("Title required"));
      db.prepare(
        "UPDATE records SET date=@date,start=@start,minutes=@minutes,category=@category,title=@title WHERE id=@id",
      ).run({
        id,
        date: revised.date,
        start: revised.start,
        minutes: revised.minutes,
        category: revised.category,
        title: revised.title,
      });
      return revised;
    },
  );
  app.delete("/api/records/:id", async (req, reply) => {
    const out = db
      .prepare("DELETE FROM records WHERE id=?")
      .run((req.params as { id: string }).id);
    return out.changes
      ? reply.code(204).send()
      : reply.code(404).send(fail("Record not found"));
  });
  app.get("/api/summary", async (req, reply) => {
    const date = (req.query as { date?: string }).date;
    if (!date || !isDate(date))
      return reply.code(400).send(fail("Valid date required"));
    const records = db
      .prepare("SELECT minutes,estimatedMinutes FROM records WHERE date=?")
      .all(date) as Pick<TimeRecord, "minutes" | "estimatedMinutes">[];
    return {
      date,
      count: records.length,
      actualMinutes: actualMinutes(records),
    };
  });
  app.get("/api/review", async (req, reply) => {
    const { from, to } = req.query as { from?: string; to?: string };
    if (
      !from ||
      !to ||
      !isDate(from) ||
      !isDate(to) ||
      from > to ||
      (Date.parse(to) - Date.parse(from)) / 86400000 > 366
    )
      return reply
        .code(400)
        .send(fail("Valid range of at most 366 days required"));
    const rows = db
      .prepare(
        "SELECT date,start,minutes,category FROM records WHERE date>=? AND date<=? ORDER BY date,start",
      )
      .all(from, to) as unknown as Pick<
      TimeRecord,
      "date" | "start" | "minutes" | "category"
    >[];
    const dates = new Map<string, typeof rows>(),
      categoryTotals = new Map<string, number>();
    for (const row of rows) {
      const day = dates.get(row.date) || [];
      day.push(row);
      dates.set(row.date, day);
      if (row.minutes > 0)
        categoryTotals.set(
          row.category || "未分类",
          (categoryTotals.get(row.category || "未分类") || 0) + row.minutes,
        );
    }
    const days = [...dates.entries()].map(([date, records]) => ({
      date,
      count: records.length,
      ...dayTimeStats(records),
    }));
    return {
      from,
      to,
      recordCount: rows.length,
      recordedMinutes: days.reduce((sum, day) => sum + day.recordedMinutes, 0),
      coveredMinutes: days.reduce((sum, day) => sum + day.coveredMinutes, 0),
      days,
      categories: [...categoryTotals.entries()]
        .map(([name, minutes]) => ({ name, minutes }))
        .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name)),
    };
  });
  app.get("/api/export", async (_req, reply) => {
    // All reads are synchronous on one SQLite connection and share one snapshot.
    db.exec("BEGIN");
    try {
      const projects = db.prepare("SELECT * FROM projects ORDER BY id").all();
      const tasks = db.prepare("SELECT * FROM tasks ORDER BY id").all();
      const records = db.prepare("SELECT * FROM records ORDER BY id").all();
      db.exec("COMMIT");
      reply.header("cache-control", "no-store");
      reply.header(
        "content-disposition",
        `attachment; filename="lubi-web-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      return {
        format: "lubi-web-data",
        version: 1,
        exportedAt: new Date().toISOString(),
        projects,
        tasks,
        records,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
  app.post("/api/obsidian/preview", async (req, reply) => {
    const preview = previewObsidianExport(req.body);
    reply.header("cache-control", "no-store");
    return (
      preview.result ||
      reply.code(400).send(fail(preview.error || "Invalid plugin export"))
    );
  });
  app.post("/api/import/preview", async (req, reply) => {
    const checked = validateSnapshot(req.body);
    if (!checked.data)
      return reply.code(400).send(fail(checked.error || "Invalid Web export"));
    const token = session(req)!;
    const digest = snapshotDigest(checked.data);
    importPreviews.set(token, { digest, expires: Date.now() + 10 * 60_000 });
    const targetEmpty = ["projects", "tasks", "records"].every(
      (table) => !db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(),
    );
    reply.header("cache-control", "no-store");
    return {
      format: "lubi-web-data",
      version: 1,
      digest,
      expiresInSeconds: 600,
      targetEmpty,
      counts: {
        projects: checked.data.projects.length,
        tasks: checked.data.tasks.length,
        records: checked.data.records.length,
      },
    };
  });
  app.post("/api/import/apply", async (req, reply) => {
    const body = req.body as { data?: unknown; digest?: unknown };
    const checked = validateSnapshot(body?.data);
    if (!checked.data)
      return reply.code(400).send(fail(checked.error || "Invalid Web export"));
    const token = session(req)!;
    const preview = importPreviews.get(token);
    if (
      !preview ||
      preview.expires < Date.now() ||
      typeof body.digest !== "string" ||
      body.digest !== preview.digest ||
      snapshotDigest(checked.data) !== preview.digest
    )
      return reply
        .code(409)
        .send(fail("Preview expired or data changed; preview again"));
    try {
      restoreIntoEmptyDatabase(db, checked.data);
    } catch (error) {
      if ((error as Error).message === "TARGET_NOT_EMPTY")
        return reply.code(409).send(fail("Target database is not empty"));
      app.log.error(error, "Web restore failed and rolled back");
      return reply.code(400).send(fail("Restore failed; no data imported"));
    }
    importPreviews.delete(token);
    reply.header("cache-control", "no-store");
    return {
      ok: true,
      counts: {
        projects: checked.data.projects.length,
        tasks: checked.data.tasks.length,
        records: checked.data.records.length,
      },
    };
  });
}
