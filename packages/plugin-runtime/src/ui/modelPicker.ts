// Editable model combobox: opening is unfiltered; only typing starts filtering.
import { iconButton } from "./components";
let modelListId = 0;
export function modelPicker(input: HTMLInputElement, initial: string, pick: (model: string) => void): { setModels: (names: string[]) => void } {
  const host = document.createElement("div");host.className = "lubi-model-picker";
  input.before(host);host.append(input);
  input.autocomplete = "off";input.removeAttribute("list");
  const list = host.createDiv({ cls: "lubi-model-options", attr: { role: "listbox" } });
  list.id = `lubi-model-options-${++modelListId}`;list.hidden = true;
  const label = host.createSpan({ cls: "lubi-sr-only", text: "可用 AI 模型", attr: { id: `${list.id}-label` } });
  list.setAttribute("aria-labelledby", label.id);
  input.setAttribute("role", "combobox");input.setAttribute("aria-autocomplete", "list");input.setAttribute("aria-controls", list.id);input.setAttribute("aria-expanded", "false");
  let names = initial ? [initial] : [], shown: string[] = [], active = -1, open = false, query = "";
  const close = () => { open = false;list.hidden = true;active = -1;input.setAttribute("aria-expanded", "false");input.removeAttribute("aria-activedescendant");toggle.setAttribute("aria-expanded", "false"); };
  const select = (name: string) => { input.value = name;pick(name);input.focus({ preventScroll: true });close(); };
  const render = () => {
    shown = names.filter(name => name.toLocaleLowerCase().includes(query));active = -1;
    list.empty();list.scrollTop = 0;input.removeAttribute("aria-activedescendant");
    for (const [i, name] of shown.entries()) {
      const option = list.createDiv({ cls: "lubi-model-option", text: name, attr: { role: "option", "aria-selected": String(name === input.value), id: `${list.id}-${i}` } });
      option.addEventListener("mousedown", e => e.preventDefault());option.addEventListener("click", () => select(name));
    }
    if (!shown.length) list.createDiv({ cls: "lubi-model-empty", text: names.length ? "无匹配模型，可继续手动填写" : "请先获取模型列表，也可手动填写", attr: { role: "status" } });
    list.hidden = !open;input.setAttribute("aria-expanded", String(open));toggle.setAttribute("aria-expanded", String(open));
  };
  const showAll = () => { query = "";open = true;render(); };
  const toggle = iconButton(host, "chevron-down", "展开全部模型", () => { if (open) close();else { input.focus({ preventScroll: true });showAll(); } }, "lubi-model-toggle");
  toggle.setAttribute("aria-controls", list.id);toggle.setAttribute("aria-expanded", "false");toggle.addEventListener("mousedown", e => e.preventDefault());
  input.addEventListener("focus", showAll);input.addEventListener("click", showAll);
  input.addEventListener("input", () => { query = input.value.trim().toLocaleLowerCase();open = true;render(); });
  host.addEventListener("focusout", e => { if (!(e.relatedTarget instanceof Node) || !host.contains(e.relatedTarget)) close(); });
  input.addEventListener("keydown", e => {
    if (e.isComposing) return;
    if (e.key === "Escape" && open) { e.preventDefault();e.stopPropagation();close();return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();e.stopPropagation();if (!open) showAll();if (!shown.length) return;
      active = active < 0 ? (e.key === "ArrowDown" ? 0 : shown.length - 1) : (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      [...list.children].forEach((el, i) => el.setAttribute("aria-selected", String(i === active)));
      const option = list.children[active] as HTMLElement;input.setAttribute("aria-activedescendant", option.id);option.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter" && open && active >= 0) { e.preventDefault();e.stopPropagation();select(shown[active]); }
  });
  return { setModels: values => { names = [...new Set(values)];showAll(); } };
}
