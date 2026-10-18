// Uses the existing browser harness with synthetic DOM only; no owner data or service is opened.
import { build } from "esbuild";
import { chromium } from "playwright";
import { browserOptions } from "./support.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const expected = JSON.parse(
  readFileSync("test/fixtures/host-contract-433a258.json", "utf8"),
);
const bundle = await build({
  stdin: {
    contents:
      'import * as host from "./apps/web/src/host/obsidian.ts";import {Modal} from "./apps/web/src/host/modal.ts";import {TFile} from "./apps/web/src/host/vault.ts";globalThis.__hostContract=host;globalThis.__hostIdentity={modal:host.Modal===Modal,file:host.TFile===TFile};',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
});
const browser = await chromium.launch(await browserOptions());
try {
  const page = await browser.newPage();
  await page.setContent(
    '<!doctype html><html><body><main id="root"></main></body></html>',
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const identities = await page.evaluate(() => globalThis.__hostIdentity);
  assert.deepEqual(identities, { modal: true, file: true });
  const result = await page.evaluate(() => {
    const h = globalThis.__hostContract;
    const prototypes = {};
    for (const [name, value] of Object.entries(h))
      if (typeof value === "function" && value.prototype)
        prototypes[name] = Object.getOwnPropertyNames(value.prototype).sort();
    const app = new h.App();
    const first = new h.Modal(app);
    first.setTitle("Contract fixture");
    first.contentEl.createEl("input", {
      attr: { "aria-label": "Fixture input" },
    });
    first.open();
    const firstMarkup = first.modalEl.outerHTML;
    app.plugin = {
      commands: [{ id: "fixture", name: "Synthetic command", callback() {} }],
      register() {},
    };
    app.showCommands();
    const palette = document.querySelector(".web-command-palette");
    const state = {
      rootInert: document.getElementById("root").inert,
      firstInert: first.containerEl.inert,
      commandListId: palette.querySelector("[role=listbox]").id,
      commandLabelId: palette.getAttribute("aria-labelledby"),
    };
    const exports = Object.keys(h).sort();
    return {
      exports,
      prototypes,
      version: h.apiVersion,
      desktop: h.Platform.isDesktopApp,
      mobile: h.Platform.isMobileApp,
      domHelpers: [
        "createEl",
        "createDiv",
        "createSpan",
        "createSvg",
        "empty",
        "setText",
      ].filter((name) => typeof Node.prototype[name] === "function"),
      firstMarkup,
      nested: state,
    };
  });
  assert.deepEqual(
    result,
    expected.contract,
    "Host exports, prototypes, modal markup or nested ID/focus state changed from the baseline",
  );
  writeFileSync(
    "test/.out/host-contract-report.json",
    JSON.stringify(
      {
        passed: true,
        baseline: expected.baseline,
        exports: result.exports.length,
        classIdentityPreserved: true,
        modalMarkupPreserved: true,
        nestedStatePreserved: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS host contract: 23 original exports, class identity, modal markup and nested dialog IDs/inert state preserved.",
  );
} finally {
  await browser.close();
}
