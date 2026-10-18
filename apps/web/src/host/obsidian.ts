// Stable Obsidian compatibility entry. Do not import legacy business rules here.
// The original plugin continues to import this exact API through Vite's alias.
import "./dom";
export { TFile, TFolder, normalizePath } from "./vault";
export {
  setIcon,
  Notice,
  Menu,
  TextComponent,
  DropdownComponent,
  Setting,
} from "./ui";
export { Modal } from "./modal";
export { SecretStorage, SecretComponent } from "./secrets";
export { WorkspaceLeaf, ItemView } from "./workspace";
export { Plugin, PluginSettingTab } from "./plugin";
export { App } from "./app";
export {
  Platform,
  FileSystemAdapter,
  apiVersion,
  requireApiVersion,
  requestUrl,
  downloadText,
} from "./browser";
