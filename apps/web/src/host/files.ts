import { api } from "./vault";
import { Modal } from "./modal";
import type { App } from "./app";
export function restoreFiles(app: App) {
  const modal = new Modal(app);
  modal.setTitle("恢复 Web 文件备份");
  modal.modalEl.addClass("lubi-modal", "web-secret-modal");
  modal.contentEl.createEl("p", {
    text: "只复制到新的隔离目录，不覆盖当前文件。此备份保留日记正文，但不含设置、密钥或删除历史；整库备份请用 npm run backup。",
  });
  const input = modal.contentEl
    .createEl("label", { text: "选择 Web 文件备份" })
    .createEl("input", {
      type: "file",
      attr: {
        accept: ".json,application/json",
        "aria-label": "选择 Web 文件备份",
      },
    });
  const status = modal.contentEl.createEl("p", { attr: { role: "status" } });
  const label = modal.contentEl.createEl("label");
  const checked = label.createEl("input", { type: "checkbox" });
  label.append(" 已核对，创建隔离副本");
  const save = modal.contentEl.createEl("button", {
    text: "确认隔离恢复 Web 文件",
    type: "button",
    cls: "mod-cta",
  });
  save.disabled = true;
  let draft: any,
    generation = 0;
  input.onchange = async () => {
    const current = ++generation;
    draft = undefined;
    checked.checked = false;
    save.disabled = true;
    status.setText("正在校验…");
    try {
      const file = input.files?.[0];
      if (!file) {
        status.setText("请选择备份文件。");
        return;
      }
      if (file.size > 25 * 1024 * 1024)
        throw new Error("文件超过 25MiB，请使用 SQLite 备份／隔离恢复命令。");
      const raw = JSON.parse(await file.text());
      const result = await api("/vault/restore/preview", {
        method: "POST",
        body: JSON.stringify({ snapshot: raw }),
      });
      if (current !== generation) return;
      draft = raw;
      status.setText(
        `${result.files} 个文件 · ${result.folders} 个文件夹；不会应用设置或密钥。`,
      );
    } catch (e) {
      if (current === generation) status.setText((e as Error).message);
    }
  };
  checked.onchange = () => (save.disabled = !draft || !checked.checked);
  save.onclick = async () => {
    if (!draft || !checked.checked) return;
    save.disabled = true;
    input.disabled = true;
    try {
      const result = await api("/vault/restore", {
        method: "POST",
        body: JSON.stringify({ snapshot: draft, confirmed: true }),
      });
      draft = undefined;
      checked.checked = false;
      await app.vault.initialize();
      status.setText("已恢复到 " + result.root + "；当前任务与日记未改变。");
      const show = modal.contentEl.createEl("button", {
        text: "查看恢复文件",
        type: "button",
      });
      show.onclick = () => app.showFiles();
    } catch (e) {
      status.setText((e as Error).message);
      save.disabled = false;
    } finally {
      input.disabled = false;
    }
  };
  modal.open();
}

export function showFiles(app: App) {
  const modal = new Modal(app);
  modal.setTitle("Web Vault 文件");
  modal.modalEl.addClass("lubi-modal");
  const list = modal.contentEl.createDiv({ cls: "web-files" });
  for (const file of app.vault
    .getFiles()
    .sort((a, b) => a.path.localeCompare(b.path))) {
    const b = list.createEl("button", { text: file.path, type: "button" });
    b.onclick = () => void app.workspace.getLeaf().openFile(file);
  }
  if (!list.childElementCount)
    list.createEl("p", { text: "还没有文件。新建任务或记录后会自动保存。" });
  modal.open();
}
