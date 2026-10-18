import type { Rec } from "./records";
import type { Task } from "./tasks";

export interface NameUse { category: string; title: string; usedAt: number }

/** Read only valid local metadata; never trust stored settings to have the right shape. */
export function validNameUses(value: unknown): NameUse[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is NameUse => !!v && typeof v.category === "string" && typeof v.title === "string" && !!v.title.trim() && typeof v.usedAt === "number" && Number.isFinite(v.usedAt) && v.usedAt > 0);
}

export function historyNames(category: string, records: Rec[], tasks: Task[], uses: NameUse[]): string[] {
  const names = new Map<string, number>();
  const add = (cat: string, title: string, at: number) => {
    const name = title.trim();
    if (cat === category && name) names.set(name, Math.max(names.get(name) ?? 0, Number.isFinite(at) ? at : 0));
  };
  for (const r of records) add(r.category, r.title, Date.parse(`${r.date}T${r.start || "00:00"}:00`));
  for (const t of tasks) add(t.category, t.title, Date.parse(t.created));
  // Metadata affects order only: deleted source names must not reappear from this cache.
  for (const u of uses) if (u.category === category && names.has(u.title.trim())) add(u.category, u.title, u.usedAt);
  return [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([name]) => name);
}
