import { api } from "./vault";
import type { App } from "./app";
import type { WorkspaceLeaf } from "./workspace";
export class PluginSettingTab {
  containerEl: HTMLElement;
  constructor(
    public app: App,
    public plugin: any,
  ) {
    this.containerEl = document.createElement("div");
  }
  display() {}
  hide() {}
}
export class Plugin {
  settingTabs: any[] = [];
  commands: any[] = [];
  private disposers: (() => void)[] = [];
  private settingsRevision = 0;
  constructor(
    public app: App,
    public manifest: any,
  ) {
    app.plugin = this;
  }
  async loadData() {
    const value = await api("/vault/settings");
    this.settingsRevision = value.revision;
    return value.data;
  }
  async saveData(data: unknown) {
    const value = await api("/vault/settings", {
      method: "PUT",
      body: JSON.stringify({ data, expectedRevision: this.settingsRevision }),
    });
    this.settingsRevision = value.revision;
  }
  registerView(type: string, factory: (leaf: WorkspaceLeaf) => any) {
    this.app.workspace.factories.set(type, factory);
  }
  addRibbonIcon(_icon: string, _name: string, _callback: () => unknown) {
    return document.createElement("button");
  }
  addSettingTab(tab: any) {
    this.settingTabs.push(tab);
  }
  addCommand(command: any) {
    this.commands.push(command);
  }
  registerEvent(disposer: () => void) {
    this.disposers.push(disposer);
  }
  register(fn: () => void) {
    this.disposers.push(fn);
  }
  unload() {
    for (const dispose of this.disposers) dispose();
    this.app.vault.stop();
  }
}
