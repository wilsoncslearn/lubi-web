// 通用的"垂直时间拖动"：移动 / 拉伸 / 框选新建。
// 用 Pointer Events 自己画，不用 HTML5 DnD（后者不能拉伸边缘、坐标不精确、Windows 上有半透明拖影）。
// 拖动过程中只回调几何信息，由调用方改 transform / height；松手才写文件。

export type DragMode = "move" | "resize-start" | "resize-end" | "create";

export interface DragState {
  start: number; // 分钟
  minutes: number;
  col: number; // 横向列偏移（周日程用），单列场景恒为 0
  moved: boolean; // 是否超过阈值（区分点击与拖动）
}

export interface DragSpec {
  mode: DragMode;
  /** Horizontal time axes share the same minute snapping, resize and cancellation logic. */
  axis?: "x" | "y";
  start: number;
  minutes: number;
  pxPerMin: number;
  /** 分钟下界 / 上界（默认 0 / 1440） */
  min?: number;
  max?: number;
  /** 最小时长（默认 5） */
  minMinutes?: number;
  /** 吸附粒度（默认 5；按住 Shift 为 1） */
  snap?: number;
  /** 按住 Alt 时吸附到这些分钟刻度（相邻记录的边缘） */
  edges?: number[];
  /** 横向：列宽与允许的列偏移范围 */
  horizontal?: { colWidth: number; minCol: number; maxCol: number };
  /** 拖动超过阈值前的像素（默认 4） */
  threshold?: number;
  onStart?: () => void;
  onMove: (s: DragState) => void;
  /** 松手：moved=false 表示只是点击；null 表示取消（Esc / 右键） */
  onEnd: (s: DragState | null) => void;
}

const ALT_SNAP_RANGE = 12; // 分钟

export function startDrag(e: PointerEvent, spec: DragSpec): void {
  if (e.button !== 0) return;
  const target = e.currentTarget as HTMLElement;
  const min = spec.min ?? 0;
  const max = spec.max ?? 1440;
  const minMinutes = spec.minMinutes ?? 5;
  const threshold = spec.threshold ?? 4;
  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;
  let started = false;
  let last: DragState = { start: spec.start, minutes: spec.minutes, col: 0, moved: false };
  const anchor = spec.mode === "create" ? spec.start : 0;

  const snapTo = (v: number, ev: PointerEvent): number => {
    if (ev.altKey && spec.edges?.length) {
      let best = v;
      let dist = ALT_SNAP_RANGE + 1;
      for (const edge of spec.edges) {
        const d = Math.abs(edge - v);
        if (d < dist) {
          dist = d;
          best = edge;
        }
      }
      if (dist <= ALT_SNAP_RANGE) return best;
    }
    const g = ev.shiftKey ? 1 : spec.snap ?? 5;
    return Math.round(v / g) * g;
  };

  const compute = (ev: PointerEvent): DragState => {
    const dMin = (spec.axis === "x" ? ev.clientX - startX : ev.clientY - startY) / spec.pxPerMin;
    let start = spec.start;
    let minutes = spec.minutes;
    switch (spec.mode) {
      case "move": {
        start = snapTo(spec.start + dMin, ev);
        start = Math.max(min, Math.min(max - minutes, start));
        break;
      }
      case "resize-start": {
        const end = spec.start + spec.minutes;
        start = snapTo(spec.start + dMin, ev);
        start = Math.max(min, Math.min(end - minMinutes, start));
        minutes = end - start;
        break;
      }
      case "resize-end": {
        let end = snapTo(spec.start + spec.minutes + dMin, ev);
        end = Math.max(start + minMinutes, Math.min(max, end));
        minutes = end - start;
        break;
      }
      case "create": {
        const cur = snapTo(anchor + dMin, ev);
        const a = Math.max(min, Math.min(max, Math.min(anchor, cur)));
        const b = Math.max(min, Math.min(max, Math.max(anchor, cur)));
        start = a;
        minutes = Math.max(minMinutes, b - a);
        if (start + minutes > max) start = max - minutes;
        break;
      }
    }
    let col = 0;
    if (spec.horizontal) {
      col = Math.round((ev.clientX - startX) / spec.horizontal.colWidth);
      col = Math.max(spec.horizontal.minCol, Math.min(spec.horizontal.maxCol, col));
    }
    return { start, minutes, col, moved };
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("contextmenu", onCtx, true);
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    document.body.removeClass("lubi-dragging");
  };
  const onMove = (ev: PointerEvent) => {
    if (!moved) {
      if (Math.abs(ev.clientY - startY) < threshold && Math.abs(ev.clientX - startX) < threshold) return;
      moved = true;
    }
    if (!started) {
      started = true;
      document.body.addClass("lubi-dragging");
      spec.onStart?.();
    }
    ev.preventDefault();
    last = compute(ev);
    spec.onMove(last);
  };
  const onUp = (ev: PointerEvent) => {
    cleanup();
    if (!moved) {
      spec.onEnd({ start: spec.start, minutes: spec.minutes, col: 0, moved: false });
      return;
    }
    ev.preventDefault();
    spec.onEnd({ ...compute(ev), moved: true });
  };
  const onCancel = () => {
    cleanup();
    spec.onEnd(null);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onCancel();
    }
  };
  const onCtx = (ev: Event) => {
    ev.preventDefault();
    onCancel();
  };
  try {
    target.setPointerCapture(e.pointerId);
  } catch {
    /* jsdom 等环境没有 pointer capture */
  }
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("contextmenu", onCtx, true);
}

/** 把 clientY 换算成分钟（相对某个容器顶部） */
export function minuteAt(clientY: number, container: HTMLElement, pxPerMin: number, offsetMin = 0): number {
  const rect = container.getBoundingClientRect();
  return offsetMin + (clientY - rect.top) / pxPerMin;
}

