import "./dom";
import icons from "./icons.json";
export function setIcon(el: HTMLElement, name: string) {
  const alias: Record<string, string> = {
    "bar-chart-3": "chart-column",
    "more-horizontal": "ellipsis",
    "more-vertical": "ellipsis-vertical",
  };
  el.setAttribute("data-icon", name);
  el.innerHTML =
    (icons as Record<string, string>)[name] ||
    (icons as Record<string, string>)[alias[name]] ||
    (icons as Record<string, string>)["circle-help"] ||
    "";
  const svg = el.querySelector("svg");
  svg?.setAttribute("aria-hidden", "true");
  svg?.classList.add("svg-icon");
}
export class Notice {
  noticeEl: HTMLDivElement;
  private timer?: number;
  constructor(message: string | DocumentFragment, duration = 5000) {
    let host = document.querySelector<HTMLElement>(".notice-container");
    if (!host) {
      host = document.body.createDiv({ cls: "notice-container" });
    }
    this.noticeEl = host.createDiv({
      cls: "notice lubi-notice",
      attr: { role: "status", "aria-live": "polite" },
    });
    if (typeof message === "string") this.noticeEl.textContent = message;
    else this.noticeEl.append(message);
    if (duration > 0)
      this.timer = window.setTimeout(() => this.hide(), duration);
  }
  hide() {
    if (this.timer) clearTimeout(this.timer);
    this.noticeEl.remove();
  }
  setMessage(message: string) {
    this.noticeEl.textContent = message;
    return this;
  }
}
export class Menu {
  private items: {
    title: string;
    icon?: string;
    callback?: () => unknown;
    disabled?: boolean;
    separator?: boolean;
  }[] = [];
  addItem(fn: Function) {
    const item: any = {
      title: "",
      setTitle(v: string) {
        this.title = v;
        return this;
      },
      setIcon(v: string) {
        this.icon = v;
        return this;
      },
      onClick(v: () => unknown) {
        this.callback = v;
        return this;
      },
      setDisabled(v: boolean) {
        this.disabled = v;
        return this;
      },
      setSection() {
        return this;
      },
    };
    fn(item);
    this.items.push(item);
    return this;
  }
  addSeparator() {
    this.items.push({ title: "", separator: true });
    return this;
  }
  showAtMouseEvent(event: MouseEvent) {
    this.showAtPosition({ x: event.clientX, y: event.clientY });
  }
  showAtPosition({ x, y }: { x: number; y: number }) {
    document.querySelector(".menu")?.remove();
    const menu = document.body.createDiv({
      cls: "menu",
      attr: { role: "menu" },
    });
    const close = () => {
      menu.remove();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
    };
    const outside = (e: Event) => {
      if (!menu.contains(e.target as Node)) close();
    };
    const buttons: HTMLButtonElement[] = [];
    for (const item of this.items) {
      if (item.separator) {
        menu.createEl("hr");
        continue;
      }
      const b = menu.createEl("button", {
        cls: "menu-item",
        attr: { role: "menuitem", type: "button" },
      });
      b.disabled = !!item.disabled;
      if (item.icon)
        setIcon(b.createSpan({ cls: "menu-item-icon" }), item.icon);
      b.createSpan({ text: item.title });
      b.addEventListener("click", () => {
        close();
        item.callback?.();
      });
      buttons.push(b);
    }
    const keys = (e: KeyboardEvent) => {
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        buttons[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length
        ]?.focus();
      }
    };
    const box = menu.getBoundingClientRect();
    menu.style.left =
      Math.max(8, Math.min(x, innerWidth - box.width - 8)) + "px";
    menu.style.top =
      Math.max(8, Math.min(y, innerHeight - box.height - 8)) + "px";
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    buttons[0]?.focus();
  }
}
export class TextComponent {
  inputEl: HTMLInputElement | HTMLTextAreaElement;
  constructor(parent: HTMLElement, tag: "input" | "textarea" = "input") {
    this.inputEl = parent.createEl(tag) as HTMLInputElement;
    if (tag === "input") this.inputEl.setAttribute("type", "text");
  }
  setValue(value: string) {
    this.inputEl.value = value;
    return this;
  }
  getValue() {
    return this.inputEl.value;
  }
  setPlaceholder(value: string) {
    this.inputEl.placeholder = value;
    return this;
  }
  setDisabled(value: boolean) {
    this.inputEl.disabled = value;
    return this;
  }
  onChange(fn: (value: string) => unknown) {
    this.inputEl.addEventListener("input", () => fn(this.inputEl.value));
    return this;
  }
}
export class DropdownComponent {
  selectEl: HTMLSelectElement;
  constructor(parent: HTMLElement) {
    this.selectEl = parent.createEl("select");
  }
  addOption(value: string, text: string) {
    this.selectEl.createEl("option", { value, text });
    return this;
  }
  addOptions(values: Record<string, string>) {
    for (const [v, t] of Object.entries(values)) this.addOption(v, t);
    return this;
  }
  setValue(value: string) {
    this.selectEl.value = value;
    return this;
  }
  getValue() {
    return this.selectEl.value;
  }
  onChange(fn: (value: string) => unknown) {
    this.selectEl.addEventListener("change", () => fn(this.selectEl.value));
    return this;
  }
  setDisabled(value: boolean) {
    this.selectEl.disabled = value;
    return this;
  }
}
class ToggleComponent {
  toggleEl: HTMLElement;
  private value = false;
  private changed?: (v: boolean) => unknown;
  constructor(parent: HTMLElement) {
    this.toggleEl = parent.createDiv({
      cls: "checkbox-container",
      attr: { role: "checkbox", tabindex: "0" },
    });
    this.toggleEl.addEventListener("click", () => {
      this.setValue(!this.value);
      this.changed?.(this.value);
    });
    this.toggleEl.addEventListener("keydown", (e) => {
      if (["Enter", " "].includes(e.key)) {
        e.preventDefault();
        this.toggleEl.click();
      }
    });
  }
  setValue(v: boolean) {
    this.value = !!v;
    this.toggleEl.toggleClass("is-enabled", this.value);
    this.toggleEl.setAttribute("aria-checked", String(this.value));
    return this;
  }
  onChange(fn: (v: boolean) => unknown) {
    this.changed = fn;
    return this;
  }
}
class ButtonComponent {
  buttonEl: HTMLButtonElement;
  extraSettingsEl: HTMLButtonElement;
  constructor(parent: HTMLElement, extra = false) {
    this.buttonEl = parent.createEl("button", {
      type: "button",
      cls: extra ? "extra-setting-button clickable-icon" : "",
    });
    this.extraSettingsEl = this.buttonEl;
    this.buttonEl.addEventListener("mousedown", (e) => e.preventDefault());
  }
  setButtonText(value: string) {
    this.buttonEl.setText(value);
    return this;
  }
  setCta() {
    this.buttonEl.addClass("mod-cta");
    return this;
  }
  setWarning() {
    this.buttonEl.addClass("mod-warning");
    return this;
  }
  setDisabled(v: boolean) {
    this.buttonEl.disabled = v;
    return this;
  }
  setIcon(name: string) {
    setIcon(this.buttonEl, name);
    return this;
  }
  setTooltip(text: string) {
    this.buttonEl.setAttribute("aria-label", text);
    return this;
  }
  onClick(fn: (event: MouseEvent) => unknown) {
    this.buttonEl.addEventListener("click", fn);
    return this;
  }
}
export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  constructor(parent: HTMLElement) {
    this.settingEl = parent.createDiv({ cls: "setting-item" });
    this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
    this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
  }
  setName(v: string) {
    this.nameEl.setText(v);
    return this;
  }
  setDesc(v: string | DocumentFragment) {
    this.descEl.empty();
    typeof v === "string" ? this.descEl.setText(v) : this.descEl.append(v);
    return this;
  }
  setHeading() {
    this.settingEl.addClass("setting-item-heading");
    return this;
  }
  addText(fn: (v: TextComponent) => unknown) {
    fn(new TextComponent(this.controlEl));
    return this;
  }
  addTextArea(fn: (v: TextComponent) => unknown) {
    fn(new TextComponent(this.controlEl, "textarea"));
    return this;
  }
  addDropdown(fn: (v: DropdownComponent) => unknown) {
    fn(new DropdownComponent(this.controlEl));
    return this;
  }
  addToggle(fn: (v: ToggleComponent) => unknown) {
    fn(new ToggleComponent(this.controlEl));
    return this;
  }
  addButton(fn: (v: ButtonComponent) => unknown) {
    fn(new ButtonComponent(this.controlEl));
    return this;
  }
  addExtraButton(fn: (v: ButtonComponent) => unknown) {
    fn(new ButtonComponent(this.controlEl, true));
    return this;
  }
}
