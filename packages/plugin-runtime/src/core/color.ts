// 颜色工具：检测分类色与主题强调色是否撞色（纯函数，可单测）。

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Obsidian 默认（浅色）主题的颜色变量取值，仅用于无 DOM 环境下的估算与单测。 */
export const OBSIDIAN_DEFAULT_COLORS: Record<string, string> = {
  "--color-red": "#e93147",
  "--color-orange": "#ec7500",
  "--color-yellow": "#e0ac00",
  "--color-green": "#08b94e",
  "--color-cyan": "#00bfbc",
  "--color-blue": "#086ddd",
  "--color-purple": "#7852ee",
  "--color-pink": "#d53984",
  "--color-base-50": "#7f7f7f",
  "--color-base-60": "#5c5c5c",
  "--interactive-accent": "#8a5cf5",
};

export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) };
  m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  return null;
}

/** var(--x) → 默认表取值；其他原样解析 */
export function resolveDefault(value: string): RGB | null {
  const v = value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (v) return parseColor(OBSIDIAN_DEFAULT_COLORS[v[1]] || v[2] || "");
  return parseColor(value);
}

export function hsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h *= 60;
  return { h, s, l };
}

export function hueDistance(a: RGB, b: RGB): number {
  const d = Math.abs(hsl(a).h - hsl(b).h) % 360;
  return d > 180 ? 360 - d : d;
}

/** 两个颜色是否「看起来是同一种彩色」：双方都有足够饱和度且色相接近 */
export function looksLikeSameHue(a: RGB, b: RGB, threshold = 20): boolean {
  if (hsl(a).s < 0.25 || hsl(b).s < 0.25) return false;
  return hueDistance(a, b) < threshold;
}

export function accentConflicts(
  categories: readonly { name: string; color: string }[],
  accent: string,
  resolve: (value: string) => RGB | null = resolveDefault,
  threshold = 20,
): string[] {
  const a = resolve(accent);
  if (!a) return [];
  return categories.filter((c) => {
    const rgb = resolve(c.color);
    return !!rgb && looksLikeSameHue(rgb, a, threshold);
  }).map((c) => c.name);
}
