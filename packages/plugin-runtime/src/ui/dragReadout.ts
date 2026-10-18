/** Keep drag feedback beside the left ruler, aligned with the active time guide. */
export function positionDragReadout(readout: HTMLElement, target: HTMLElement, scroller: HTMLElement, tl: HTMLElement, wrap: HTMLElement, atEnd = false): void {
  const wrapRect = wrap.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
  const bodyRect = wrap.closest(".lubi-body")?.getBoundingClientRect();
  const topBound = Math.max(viewport.top + 2, bodyRect?.top || 0);
  const bottomBound = Math.min(viewport.bottom - 2, bodyRect?.bottom || window.innerHeight);
  const width = readout.offsetWidth || 80, height = readout.offsetHeight || 18;
  const axis = tl.querySelector<HTMLElement>(".lubi-tl-canvas")?.getBoundingClientRect().left ?? viewport.left;
  const guide = tl.querySelector<HTMLElement>(".lubi-tl-hover.is-drag-guide")?.getBoundingClientRect();
  const block = target.getBoundingClientRect();
  const edge = guide ? guide.top + guide.height / 2 : atEnd ? block.bottom + 2 : block.top;
  const x = Math.max(viewport.left + 2, axis - width - 4), y = edge - height / 2;
  // Never pin an off-screen time to a different visible hour or clip the label.
  const visible = y >= topBound && y + height <= bottomBound;
  readout.style.visibility = visible ? "" : "hidden";
  readout.style.left = `${x - wrapRect.left}px`;
  readout.style.top = `${y - wrapRect.top}px`;
  // Continue the guide inside each intersecting card: above its fill, below its text.
  for (const card of tl.querySelectorAll<HTMLElement>(".lubi-block, .lubi-plan")) {
    let segment = card.querySelector<HTMLElement>(":scope > .lubi-drag-guide-segment");
    const rect = card.getBoundingClientRect(), style = window.getComputedStyle(card);
    const originX = rect.left + (parseFloat(style.borderLeftWidth) || 0);
    const originY = rect.top + (parseFloat(style.borderTopWidth) || 0);
    const left = Math.max(originX, guide?.left ?? originX);
    const right = Math.min(rect.right - (parseFloat(style.borderRightWidth) || 0), guide?.right ?? originX);
    if (!visible || !guide || !rect.height || guide.top >= rect.bottom || guide.bottom <= rect.top || right <= left) {
      segment?.remove(); card.classList.remove("lubi-drag-guide-host"); continue;
    }
    if (!segment) {
      segment = document.createElement("span"); segment.className = "lubi-drag-guide-segment";
      segment.setAttribute("aria-hidden", "true"); card.appendChild(segment);
    }
    card.classList.add("lubi-drag-guide-host");
    segment.style.left = `${left - originX}px`;
    segment.style.top = `${guide.top - originY}px`;
    segment.style.width = `${right - left}px`;
  }
  for (const label of tl.querySelectorAll<HTMLElement>(".lubi-hour-label, .lubi-now-label")) {
    label.classList.remove("lubi-drag-obscured");
    const rect = label.getBoundingClientRect();
    if (visible && rect.width && rect.right > x && rect.left < x + width && rect.bottom > y && rect.top < y + height) {
      label.classList.add("lubi-drag-obscured");
    }
  }
}
