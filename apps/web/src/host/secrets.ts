import { api } from "./vault";
import { DropdownComponent, Notice } from "./ui";
import { Modal } from "./modal";
import type { App } from "./app";
export class SecretStorage {
  private names = new Set<string>();
  async initialize() {
    const result = await api("/secrets");
    this.names = new Set(result.names);
  }
  getSecret(id: string) {
    return this.names.has(id) ? "lubi-web-key:" + id : null;
  }
  listSecrets() {
    return [...this.names];
  }
  async setSecret(id: string, value: string) {
    await api("/secrets/" + encodeURIComponent(id), {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
    this.names.add(id);
  }
  async deleteSecret(id: string) {
    await api("/secrets/" + encodeURIComponent(id), { method: "DELETE" });
    this.names.delete(id);
  }
  clear() {
    this.names.clear();
  }
}
export class SecretComponent extends DropdownComponent {
  constructor(app: App, parent: HTMLElement) {
    super(parent);
    this.selectEl.setAttribute("aria-label", "服务端密钥");
    const refresh = () => {
      this.selectEl.replaceChildren();
      this.addOption("", "选择服务端密钥…");
      for (const id of app.secretStorage.listSecrets()) this.addOption(id, id);
    };
    refresh();
    const add = parent.createEl("button", { text: "新增密钥", type: "button" });
    add.addEventListener("mousedown", (e) => e.preventDefault());
    add.onclick = () => {
      const modal = new Modal(app);
      modal.setTitle("服务端加密密钥库");
      modal.modalEl.addClass("lubi-modal", "web-secret-modal");
      modal.contentEl.createEl("p", {
        text: "密钥在服务端本地加密保存，不在下载文件中，也不会从服务器回传浏览器；与 Obsidian 系统钥匙串独立。请一并保管数据库和服务端密钥文件。",
      });
      const name = modal.contentEl
        .createEl("label", { text: "密钥名称", cls: "web-secret-label" })
        .createEl("input", {
          attr: {
            "aria-label": "密钥名称",
            placeholder: "my-ai-key",
            pattern: "[a-z0-9-]{1,64}",
            maxlength: "64",
            autocomplete: "off",
          },
        });
      const value = modal.contentEl
        .createEl("label", { text: "密钥内容", cls: "web-secret-label" })
        .createEl("input", {
          type: "password",
          attr: { "aria-label": "密钥内容", autocomplete: "new-password" },
        });
      const status = modal.contentEl.createEl("p", {
        attr: { role: "status" },
      });
      const save = modal.contentEl.createEl("button", {
        text: "保存密钥",
        type: "button",
        cls: "mod-cta",
      });
      save.onclick = async () => {
        const id = name.value.trim();
        if (!/^[a-z0-9-]{1,64}$/.test(id) || !value.value.trim()) {
          status.setText("请填写有效名称和密钥。");
          return;
        }
        if (app.secretStorage.listSecrets().includes(id)) {
          status.setText("名称已存在。为避免覆盖，请使用新的名称。");
          return;
        }
        save.disabled = true;
        try {
          await app.secretStorage.setSecret(id, value.value);
          value.value = "";
          refresh();
          this.setValue(id);
          this.selectEl.dispatchEvent(new Event("change", { bubbles: true }));
          modal.close();
          new Notice("密钥已加密保存");
        } catch (e) {
          status.setText((e as Error).message);
        } finally {
          save.disabled = false;
        }
      };
      modal.open();
    };
    const remove = parent.createEl("button", {
      text: "删除选中密钥",
      type: "button",
    });
    remove.onclick = () => {
      const id = this.getValue();
      if (!id) return;
      const modal = new Modal(app);
      modal.setTitle("删除密钥？");
      modal.contentEl.createEl("p", {
        text:
          "删除 " +
          id +
          " 后，使用它的 AI 请求将需要重新配置。此操作不可撤销。",
      });
      const cancel = modal.contentEl.createEl("button", {
        text: "取消",
        type: "button",
      });
      cancel.onclick = () => modal.close();
      const confirm = modal.contentEl.createEl("button", {
        text: "确认删除",
        type: "button",
      });
      confirm.onclick = async () => {
        confirm.disabled = true;
        try {
          await app.secretStorage.deleteSecret(id);
          refresh();
          this.setValue("");
          this.selectEl.dispatchEvent(new Event("change", { bubbles: true }));
          modal.close();
        } catch (e) {
          new Notice((e as Error).message);
          confirm.disabled = false;
        }
      };
      modal.open();
    };
  }
}
