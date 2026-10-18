// 「记一条」一行输入解析：`9:00-10:30 学习 三明治定理`、`30min 跑步`、`1h30m 看书`、`14:00 午饭`。
// 纯函数；解析不到任何时间 / 时长 / 分类时返回 null，原文作为标题。

export interface QuickParse {
  title: string;
  start?: string;
  minutes?: number;
  category?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const validHM = (h: number, m: number) => h >= 0 && h <= 24 && m >= 0 && m < 60 && !(h === 24 && m > 0);

export function parseQuick(text: string, categories: readonly string[] = []): QuickParse | null {
  let rest = ` ${text} `;
  const out: QuickParse = { title: "" };
  let hit = false;

  // 1. 时间段 09:00-10:30 / 9:00~10:30 / 9:00到10:30
  const range = rest.match(/(^|[\s,，])(\d{1,2})[:：](\d{2})\s*[-–—~～到至]\s*(\d{1,2})[:：](\d{2})(?=$|[\s,，])/);
  if (range && validHM(+range[2], +range[3]) && validHM(+range[4], +range[5])) {
    const s = +range[2] * 60 + +range[3];
    let e = +range[4] * 60 + +range[5];
    if (e <= s) e += 1440;
    out.start = `${pad(+range[2])}:${range[3]}`;
    out.minutes = e - s;
    rest = rest.replace(range[0], range[1]);
    hit = true;
  } else {
    // 2. 单个开始时间 14:00
    const one = rest.match(/(^|[\s,，])(\d{1,2})[:：](\d{2})(?=$|[\s,，])/);
    if (one && validHM(+one[2], +one[3]) && +one[2] < 24) {
      out.start = `${pad(+one[2])}:${one[3]}`;
      rest = rest.replace(one[0], one[1]);
      hit = true;
    }
  }

  // 3. 时长 1h30m / 1.5h / 90min / 30分钟 / 1小时20分
  if (out.minutes === undefined) {
    const dur = rest.match(/(^|[\s,，])(?:(\d+(?:\.\d+)?)\s*(?:hrs|hr|h|个小时|小时)(?:\s*(\d+)\s*(?:mins|min|m|分钟|分))?|(\d+)\s*(?:mins|min|m|分钟|分))(?=$|[\s,，])/i);
    if (dur) {
      const minutes = Math.round((dur[2] ? Number(dur[2]) * 60 : 0) + Number(dur[3] || 0) + Number(dur[4] || 0));
      if (minutes > 0 && minutes <= 1440) {
        out.minutes = minutes;
        rest = rest.replace(dur[0], dur[1]);
        hit = true;
      }
    }
  }

  // 4. 分类：与分类名完全相同的独立词
  if (categories.length) {
    const tokens = rest.trim().split(/\s+/);
    const idx = tokens.findIndex((t) => categories.includes(t));
    if (idx >= 0 && tokens.length > 1) {
      out.category = tokens[idx];
      tokens.splice(idx, 1);
      rest = ` ${tokens.join(" ")} `;
      hit = true;
    }
  }

  if (!hit) return null;
  out.title = rest.replace(/\s+/g, " ").replace(/^[\s·,，:：\-–]+|[\s·,，:：\-–]+$/g, "").trim();
  return out;
}

/** 预计时长输入：`150` / `150m` / `2.5h` / `1h30m` → 分钟；无法解析返回 null */
export function parseEstimate(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.max(0, Math.round(Number(t)));
  const q = parseQuick(t);
  return q && q.minutes !== undefined && !q.title && q.start === undefined ? q.minutes : null;
}
