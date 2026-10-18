import { dateStr, daysBetween } from "../core/time";

/** Keep the complete label or hide it; never show clipped numbers under resize handles. */
export function fitGanttLabel(bar: HTMLElement): void {
  const label = bar.querySelector<HTMLElement>(".lubi-gantt-bar-label");
  if (!label) return;
  const fits = !!label.textContent && bar.clientWidth > 16 && label.scrollWidth <= bar.clientWidth - 16;
  label.style.visibility = fits ? "visible" : "hidden";
}
export function fitGanttLabels(host: ParentNode): void {
  host.querySelectorAll<HTMLElement>(".lubi-gantt-bar").forEach(fitGanttLabel);
}

/** Fractional local day, shared by day/week/month and synthetic previews. */
export function updateGanttNow(host: ParentNode, now = new Date()): void {
  const today = dateStr(now);
  const fraction = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
  const selector = ".lubi-gantt-table[data-gantt-from]";
  const tables = Array.from(host.querySelectorAll<HTMLElement>(selector));
  if ("matches" in host && (host as Element).matches(selector)) tables.unshift(host as HTMLElement);
  tables.forEach(table => {
    const from = table.dataset.ganttFrom!, count = Number(table.dataset.ganttCount);
    const offset = daysBetween(from, today);
    const visible = offset >= 0 && offset < count;
    table.querySelectorAll<HTMLElement>(".lubi-gantt-today").forEach(mark => {
      mark.hidden = !visible;
      mark.style.left = `${(offset + fraction) / count * 100}%`;
    });
    table.querySelectorAll<HTMLElement>(".lubi-gantt-grid > [data-date]").forEach(cell => {
      cell.classList.toggle("is-future", cell.dataset.date! > today);
    });
  });
}
