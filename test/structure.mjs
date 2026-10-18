import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";

const root = process.cwd();
const text = (path) => readFileSync(resolve(root, path), "utf8");
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

test("the active frontend has one non-JSX entry and no retired CSS or legacy domain dependency", () => {
  assert(existsSync(resolve(root, "apps/web/src/main.ts")));
  assert(!existsSync(resolve(root, "apps/web/src/main.tsx")));
  assert(!existsSync(resolve(root, "apps/web/src/style.css")));
  assert.match(text("apps/web/index.html"), /src="\/src\/main\.ts"/);
  for (const file of walk(resolve(root, "apps/web/src")).filter((p) =>
    /\.(ts|css)$/.test(p),
  )) {
    const source = readFileSync(file, "utf8");
    assert(
      !source.includes("@lubi/domain") &&
        !source.includes("@lubi/legacy-domain"),
      relative(root, file),
    );
    assert(!source.includes("packages/legacy-domain"), relative(root, file));
  }
});

test("legacy compatibility is explicit and the server entry composes root security hooks before routes", () => {
  assert(!existsSync(resolve(root, "packages/domain/package.json")));
  assert(!existsSync(resolve(root, "apps/api/src/import.ts")));
  assert(!existsSync(resolve(root, "apps/api/src/obsidianPreview.ts")));
  assert.equal(
    JSON.parse(text("packages/legacy-domain/package.json")).name,
    "@lubi/legacy-domain",
  );
  assert.equal(
    JSON.parse(text("apps/api/package.json")).dependencies[
      "@lubi/legacy-domain"
    ],
    "*",
  );
  const lock = JSON.parse(text("package-lock.json")).packages;
  assert(!lock["node_modules/@lubi/domain"]);
  assert.equal(
    lock["node_modules/@lubi/legacy-domain"].resolved,
    "packages/legacy-domain",
  );
  const entry = text("apps/api/src/server.ts");
  const registration = [
    "registerAuthentication(",
    "registerLegacyWriteGuard(",
    "registerLegacyRoutes(",
    "registerVault(",
    "registerVaultRestore(",
    "registerSecrets(",
    "registerNetwork(",
    "registerResponseHeaders(",
    "registerStaticWeb(",
  ].map((s) => entry.indexOf(s));
  assert(
    registration.every((n, i) => n >= 0 && (!i || n > registration[i - 1])),
  );
  assert(
    !/\bapp\.(get|post|patch|delete)\s*\(/.test(entry),
    "Route handlers belong to their owning module",
  );
  for (const file of walk(resolve(root, "apps/api/src")).filter((p) =>
    p.endsWith(".ts"),
  )) {
    const source = readFileSync(file, "utf8");
    assert(!source.includes("@lubi/domain"), relative(root, file));
    if (source.includes("@lubi/legacy-domain"))
      assert(
        relative(resolve(root, "apps/api/src/legacy"), file).split(
          /[\\/]/,
        )[0] !== "..",
        "Only compatibility handlers may import the legacy model",
      );
  }
});

test("historical documents are archived and all local Markdown file links resolve", () => {
  const docs = resolve(root, "docs");
  assert(!readdirSync(docs).some((name) => name.startsWith("mcp-")));
  assert(
    readdirSync(join(docs, "archive")).filter((name) =>
      /^mcp-.*\.md$/.test(name),
    ).length >= 12,
  );
  const files = [
    resolve(root, "README.md"),
    ...walk(docs).filter((p) => p.endsWith(".md")),
  ];
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /(?<!!)\[[^\]]*\]\(([^)]+)\)/g,
    )) {
      const target = match[1].split("#")[0].replace(/^<|>$/g, "");
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      assert(
        existsSync(resolve(dirname(file), decodeURIComponent(target))),
        relative(root, file) + " -> " + target,
      );
    }
  }
});
