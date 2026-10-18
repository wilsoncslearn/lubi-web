import { Vault } from "./vault";
import { Workspace } from "./workspace";
import { SecretStorage } from "./secrets";
import { bindCommandShortcut, showCommands } from "./commands";
import { restoreFiles, showFiles } from "./files";
import { openSettings } from "./settings";
// Composition only. These methods keep the original host API stable for the plugin.
export class App {
  vault = new Vault();
  workspace = new Workspace(this);
  secretStorage = new SecretStorage();
  plugin: any;
  setting = {
    open: () => {},
    openTabById: (_id: string) => openSettings(this),
  };
  bindCommandShortcut() {
    bindCommandShortcut(this);
  }
  showCommands() {
    showCommands(this);
  }
  restoreFiles() {
    restoreFiles(this);
  }
  showFiles() {
    showFiles(this);
  }
}
