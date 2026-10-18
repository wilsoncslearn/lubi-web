import "./dom";
import { setIcon } from "./ui";
import type { App } from "./app";
const modalStack: Modal[] = [];
let nextModalId = 0;
// Dialogs and command lists intentionally share the original ID sequence.
export function allocateModalId(prefix: string) {
  return prefix + ++nextModalId;
}
export class Modal {
  containerEl: HTMLElement;
  bgEl: HTMLElement;
  modalEl: HTMLElement;
  headerEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  private previous: HTMLElement | null = null;
  private opened = false;
  private onKey = (event: KeyboardEvent) => {
    if (
      modalStack.at(-1) !== this ||
      document.querySelector(".web-login-overlay")
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
    if (event.key === "Tab") {
      const items = [
        ...this.modalEl.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,a[href],[tabindex="0"]',
        ),
      ].filter(
        (x) => !x.hasAttribute("disabled") && x.getClientRects().length > 0,
      );
      if (!items.length) {
        event.preventDefault();
        this.modalEl.focus();
        return;
      }
      const first = items[0],
        last = items.at(-1)!;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !this.modalEl.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  constructor(public app: App) {
    this.containerEl = document.createElement("div");
    this.containerEl.className = "modal-container";
    const bg = (this.bgEl = this.containerEl.createDiv({ cls: "modal-bg" }));
    bg.addEventListener("mousedown", () => {
      if (modalStack.at(-1) === this) this.close();
    });
    this.modalEl = this.containerEl.createDiv({
      cls: "modal",
      attr: { role: "dialog", "aria-modal": "true", tabindex: "-1" },
    });
    const id = allocateModalId("web-dialog-");
    this.containerEl.createSpan({
      text: "关闭",
      attr: { id: id + "-close", hidden: "" },
    });
    const close = this.modalEl.createEl("button", {
      cls: "modal-header-button mod-raised clickable-icon",
      attr: { type: "button", "aria-labelledby": id + "-close" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.close());
    this.headerEl = this.modalEl.createDiv({ cls: "modal-header" });
    this.titleEl = this.headerEl.createDiv({
      cls: "modal-title",
      attr: { id },
    });
    this.modalEl.setAttribute("aria-labelledby", id);
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  setTitle(title: string) {
    this.titleEl.textContent = title;
    return this;
  }
  onOpen(): void | Promise<void> {}
  onClose(): void {}
  open() {
    if (this.opened) return;
    this.opened = true;
    this.previous = document.activeElement as HTMLElement;
    if (modalStack.length) modalStack.at(-1)!.containerEl.inert = true;
    modalStack.push(this);
    document.body.append(this.containerEl);
    document.addEventListener("keydown", this.onKey);
    const root = document.getElementById("root");
    if (root) root.inert = true;
    this.containerEl.style.zIndex = String(1000 + modalStack.length * 10);
    try {
      void this.onOpen();
    } catch (error) {
      this.close();
      throw error;
    }
    requestAnimationFrame(() => {
      if (this.opened && !this.modalEl.contains(document.activeElement))
        (
          this.contentEl.querySelector<HTMLElement>(
            'input:not([type="hidden"]):not(:disabled),textarea:not(:disabled),[autofocus]',
          ) || this.modalEl
        ).focus();
    });
  }
  close() {
    if (!this.opened) return;
    this.opened = false;
    this.onClose();
    this.containerEl.remove();
    document.removeEventListener("keydown", this.onKey);
    const index = modalStack.indexOf(this);
    if (index >= 0) modalStack.splice(index, 1);
    if (modalStack.length) modalStack.at(-1)!.containerEl.inert = false;
    const root = document.getElementById("root");
    if (root) root.inert = modalStack.length > 0;
    if (this.previous?.isConnected) this.previous.focus();
  }
}
