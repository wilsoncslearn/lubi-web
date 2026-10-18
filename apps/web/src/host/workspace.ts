import "./dom";
import { TFile, normalizePath } from "./vault";
import { Modal } from "./modal";
import { Notice } from "./ui";
import { downloadText } from "./browser";
import type { App } from "./app";
export class WorkspaceLeaf {
  view: any;
  type = "";
  constructor(public app: App) {}
  async setViewState(state: { type: string }) {
    this.type = state.type;
    const factory = this.app.workspace.factories.get(state.type);
    if (!factory) throw new Error("Unknown view");
    this.view = factory(this);
    await this.view.onOpen();
    this.app.workspace.active = this;
  }
  async openFile(file: TFile) {
    const modal = new Modal(this.app);
    modal.setTitle(file.path);
    modal.modalEl.addClass("lubi-modal", "web-file-modal");
    const text = await this.app.vault.read(file);
    let savedText = text,
      saving = false,
      closing = false;
    modal.contentEl.createEl("p", {
      cls: "web-host-note",
      text: "原始文本编辑。保存会影响相关任务／日记；发生并发冲突时不会覆盖另一窗口。可下载保留本地草稿。",
    });
    const field = modal.contentEl.createEl("textarea", {
      cls: "web-file-editor",
      attr: { "aria-label": "文件内容", spellcheck: "false" },
    });
    field.value = text;
    const bar = modal.contentEl.createDiv({ cls: "web-file-actions" });
    const status = bar.createSpan({ attr: { role: "status" } });
    const download = bar.createEl("button", {
      text: "下载文件",
      type: "button",
    });
    download.onclick = () => downloadText(file.name, field.value);
    const save = bar.createEl("button", {
      text: "保存",
      cls: "mod-cta",
      type: "button",
    });
    save.onclick = async () => {
      save.disabled = true;
      saving = true;
      const draft = field.value;
      try {
        if (file.extension === "json") JSON.parse(draft);
        await this.app.vault.modify(file, draft);
        savedText = draft;
        status.setText(
          field.value === draft ? "已保存" : "上一版本已保存，当前修改尚未保存",
        );
      } catch (e) {
        status.setText((e as Error).message);
      } finally {
        save.disabled = false;
        saving = false;
      }
    };
    field.addEventListener("input", () =>
      status.setText(field.value === savedText ? "" : "尚未保存"),
    );
    const warn = (event: BeforeUnloadEvent) => {
      if (field.value !== savedText) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    modal.onClose = () => window.removeEventListener("beforeunload", warn);
    const close = modal.close.bind(modal);
    modal.close = () => {
      if (saving) {
        new Notice("正在保存，请稍候再关闭。");
        return;
      }
      if (closing || field.value === savedText) {
        close();
        return;
      }
      const ask = new Modal(this.app);
      ask.setTitle("文件还有未保存的修改");
      ask.contentEl.createEl("p", {
        text: "继续编辑或下载草稿可保留这些修改。丢弃不会改动服务器上的文件。",
      });
      const keep = ask.contentEl.createEl("button", {
        text: "继续编辑",
        type: "button",
      });
      keep.onclick = () => ask.close();
      const discard = ask.contentEl.createEl("button", {
        text: "丢弃未保存修改",
        type: "button",
      });
      discard.onclick = () => {
        closing = true;
        ask.close();
        close();
      };
      ask.open();
    };
    modal.containerEl.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!saving) save.click();
      }
    });
    modal.open();
  }
}
export class Workspace {
  leaves: WorkspaceLeaf[] = [];
  factories = new Map<string, (leaf: WorkspaceLeaf) => any>();
  ready: (() => unknown)[] = [];
  active?: WorkspaceLeaf;
  constructor(private app: App) {}
  onLayoutReady(fn: () => unknown) {
    this.ready.push(fn);
  }
  getLeavesOfType(type: string) {
    return this.leaves.filter((l) => l.type === type);
  }
  getLeaf() {
    const leaf = new WorkspaceLeaf(this.app);
    this.leaves.push(leaf);
    return leaf;
  }
  async openLinkText(link: string, _source: string, _newLeaf = false) {
    const path = normalizePath(link.split("#")[0]);
    const direct =
      this.app.vault.getAbstractFileByPath(path) ||
      this.app.vault.getAbstractFileByPath(path + ".md");
    const file =
      direct instanceof TFile
        ? direct
        : this.app.vault.getMarkdownFiles().find((f) => f.basename === path);
    if (file) await this.getLeaf().openFile(file);
    else new Notice("Web Vault 中找不到文件：" + path);
  }
  revealLeaf(leaf: WorkspaceLeaf) {
    this.active = leaf;
  }
  getActiveViewOfType(type: any) {
    return this.active?.view instanceof type ? this.active.view : null;
  }
}
export class ItemView {
  app: App;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  constructor(public leaf: WorkspaceLeaf) {
    this.app = leaf.app;
    this.containerEl = document.createElement("div");
    this.containerEl.className = "workspace-leaf-content";
    this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
    document.getElementById("root")!.append(this.containerEl);
  }
}
