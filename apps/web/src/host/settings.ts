import { api } from "./vault";
import { Modal } from "./modal";
import { Notice } from "./ui";
import { downloadText } from "./browser";
import type { App } from "./app";
export function openSettings(app: App) {
  const tab = app.plugin?.settingTabs[0];
  if (!tab) return;
  const modal = new Modal(app);
  modal.setTitle("Lubi 设置");
  modal.modalEl.addClass("web-settings-modal");
  modal.contentEl.createEl("p", {
    cls: "web-host-note",
    text: "独立 Web 数据库，不连接原 Vault。临时 AI Key 仅在当前会话；命名密钥由服务端本地加密保存，与 Obsidian 钥匙串独立。桌面插件安装由 Obsidian 管理。",
  });
  const actions = modal.contentEl.createDiv({ cls: "web-settings-actions" });
  const theme = actions.createEl("button", {
    text: "切换明 / 暗主题",
    type: "button",
  });
  theme.onclick = () => {
    const dark = document.body.classList.toggle("theme-dark");
    document.body.classList.toggle("theme-light", !dark);
    localStorage.setItem("lubi-theme", dark ? "dark" : "light");
  };
  const commands = actions.createEl("button", {
    text: "命令面板（Ctrl / ⌘ + P）",
    type: "button",
  });
  commands.onclick = () => app.showCommands();
  const files = actions.createEl("button", {
    text: "查看 Web 文件",
    type: "button",
  });
  files.onclick = () => app.showFiles();
  const backup = actions.createEl("button", {
    text: "下载 Web 文件备份",
    type: "button",
  });
  backup.onclick = () =>
    void api("/vault/export")
      .then((value) =>
        downloadText("lubi-web-vault.json", JSON.stringify(value, null, 2)),
      )
      .catch((e) => new Notice(e.message));
  const restore = actions.createEl("button", {
    text: "恢复 Web 文件备份",
    type: "button",
  });
  restore.onclick = () => app.restoreFiles();
  const logout = actions.createEl("button", {
    text: "退出登录",
    type: "button",
  });
  logout.onclick = async () => {
    await api("/auth/logout", { method: "POST" });
    app.secretStorage.clear();
    location.reload();
  };
  tab.display();
  modal.contentEl.append(tab.containerEl);
  modal.onClose = () => tab.hide();
  modal.open();
}
