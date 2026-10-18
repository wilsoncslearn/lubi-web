import { Modal, allocateModalId } from "./modal";
import { Notice } from "./ui";
import type { App } from "./app";
export function bindCommandShortcut(app: App) {
  const handler = (event: KeyboardEvent) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "p" &&
      !document.querySelector(".web-login")
    ) {
      event.preventDefault();
      event.stopPropagation();
      app.showCommands();
    }
  };
  document.addEventListener("keydown", handler, true);
  app.plugin.register(() =>
    document.removeEventListener("keydown", handler, true),
  );
}

export function showCommands(app: App) {
  const existing = document.querySelector<HTMLInputElement>(
    ".web-command-palette input",
  );
  if (existing) {
    existing.focus();
    return;
  }
  const commands = (app.plugin?.commands || []).filter(
    (command: any) => typeof command.callback === "function",
  );
  if (!commands.length) return;
  const modal = new Modal(app);
  modal.setTitle("Lubi 命令面板");
  modal.modalEl.addClass("lubi-modal", "web-command-palette");
  const id = allocateModalId("web-command-list-");
  const search = modal.contentEl.createEl("input", {
    type: "text",
    attr: {
      "aria-label": "搜索 Lubi 命令",
      role: "combobox",
      "aria-expanded": "true",
      "aria-autocomplete": "list",
      "aria-controls": id,
      placeholder: "输入命令名称…",
    },
  });
  const list = modal.contentEl.createDiv({
    cls: "web-command-list",
    attr: { id, role: "listbox", "aria-label": "Lubi 命令" },
  });
  let filtered: any[] = [],
    selected = 0;
  const execute = (command: any) => {
    modal.close();
    try {
      Promise.resolve(command.callback()).catch(
        (error) => new Notice("命令未完成：" + (error as Error).message),
      );
    } catch (error) {
      new Notice("命令未完成：" + (error as Error).message);
    }
  };
  const mark = () => {
    list.querySelectorAll<HTMLElement>("[role=option]").forEach((row, i) => {
      row.classList.toggle("is-selected", i === selected);
      row.setAttribute("aria-selected", String(i === selected));
      if (i === selected) {
        search.setAttribute("aria-activedescendant", row.id);
        row.scrollIntoView({ block: "nearest" });
      }
    });
  };
  const render = () => {
    const query = search.value.trim().toLocaleLowerCase();
    filtered = commands.filter(
      (c: any) =>
        c.name.toLocaleLowerCase().includes(query) ||
        c.id.toLocaleLowerCase().includes(query),
    );
    selected = 0;
    list.empty();
    search.removeAttribute("aria-activedescendant");
    for (const [i, c] of filtered.entries()) {
      const row = list.createEl("button", {
        type: "button",
        text: c.name,
        cls: "web-command-item",
        attr: {
          id: id + "-" + i,
          role: "option",
          tabindex: "-1",
          "aria-selected": "false",
        },
      });
      row.addEventListener("click", () => execute(c));
    }
    if (!filtered.length)
      list.createEl("p", { text: "没有匹配的命令", attr: { role: "status" } });
    mark();
  };
  search.addEventListener("input", render);
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length) {
        selected =
          (selected + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) %
          filtered.length;
        mark();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[selected]) execute(filtered[selected]);
    }
  });
  modal.contentEl.createEl("small", {
    cls: "web-host-note",
    text: "↑ ↓ 选择 · Enter 执行 · Esc 返回；仅运行原插件注册的命令。",
  });
  render();
  modal.open();
}
