import type LubiPlugin from "../main";

let nextId = 0;

/** One non-modal combobox shared by task and time-record forms. */
export function nameSuggestions(input: HTMLInputElement, plugin: LubiPlugin, category: () => string, pick: (title: string) => void): { refresh: () => void } {
  const host = document.createElement("div");
  host.className = "lubi-name-combobox";
  input.before(host);
  host.append(input);
  const list = document.createElement("div");
  list.className = "lubi-name-options";
  list.id = `lubi-name-options-${++nextId}`;
  list.setAttribute("role", "listbox");
  const label = document.createElement("span");
  label.className = "lubi-sr-only";
  label.id = `${list.id}-label`;
  label.textContent = "历史名称";
  host.append(label);
  list.setAttribute("aria-labelledby", label.id);
  list.hidden = true;
  host.append(list);
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  let names: string[] = [], shown: string[] = [], active = -1, ticket = 0, open = false;
  const close = () => {
    open = false; list.hidden = true; active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const select = (title: string) => {
    input.value = title;
    pick(title);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };
  const render = () => {
    const query = input.value.trim().toLocaleLowerCase();
    shown = names.filter(name => name.toLocaleLowerCase().includes(query));
    list.replaceChildren(); active = -1;
    input.removeAttribute("aria-activedescendant");
    for (const [i, name] of shown.entries()) {
      const option = document.createElement("div");
      option.className = "lubi-name-option";
      option.id = `${list.id}-${i}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = name;
      // Keep focus in the input so clicking a candidate never loses the selection to blur.
      option.addEventListener("mousedown", e => e.preventDefault());
      option.addEventListener("click", () => select(name));
      list.append(option);
    }
    list.hidden = !open || !shown.length;
    input.setAttribute("aria-expanded", String(!list.hidden));
  };
  const refresh = () => {
    const version = ++ticket;
    names = []; render();
    void plugin.nameCandidates(category()).then(result => {
      if (version !== ticket || !input.isConnected) return;
      names = result; render();
    }).catch(() => { if (version === ticket) { names = []; render(); } });
  };
  input.addEventListener("focus", () => { open = true; refresh(); });
  input.addEventListener("click", () => { open = true; refresh(); });
  input.addEventListener("input", () => { open = true; render(); });
  input.addEventListener("blur", close);
  input.addEventListener("keydown", e => {
    if (e.isComposing) return;
    if (e.key === "Escape" && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && shown.length) {
      e.preventDefault(); e.stopPropagation(); open = true; list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      active = (active + (e.key === "ArrowDown" ? 1 : active < 0 ? 0 : -1) + shown.length) % shown.length;
      [...list.children].forEach((option, i) => option.setAttribute("aria-selected", String(i === active)));
      const option = list.children[active] as HTMLElement;
      input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault(); e.stopImmediatePropagation(); select(shown[active]);
    }
  });
  refresh();
  return { refresh };
}
