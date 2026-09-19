/* Store-submission guards. Every failure here is something the Web Store review would bounce,
   or a broken reference that only shows up once the extension is loaded in a browser. */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const messages = JSON.parse(read("_locales/en/messages.json"));

const resolveMessage = (value) => {
  const match = String(value).match(/^__MSG_(.+)__$/);
  if (!match) return value;
  assert.ok(messages[match[1]], "missing message: " + match[1]);
  return messages[match[1]].message;
};

test("every file the manifest points at exists", () => {
  const referenced = [
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  for (const file of new Set(referenced)) {
    assert.ok(existsSync(path.join(root, file)), "missing file: " + file);
  }
});

test("every script and stylesheet the pages load exists", () => {
  for (const page of [manifest.action.default_popup, manifest.options_ui.page]) {
    const dir = path.dirname(page);
    const html = read(page);
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (/^(https?:)?\/\//.test(ref)) continue;
      assert.ok(existsSync(path.join(root, dir, ref)), "missing asset: " + ref + " in " + page);
    }
  }
});

test("the injected extractor is shipped and referenced by the path the popup uses", () => {
  const popup = read("src/popup.js");
  const injected = popup.match(/files:\s*\[\s*"([^"]+)"/);
  assert.ok(injected, "popup no longer injects a file");
  assert.ok(existsSync(path.join(root, injected[1])), "missing injected file: " + injected[1]);
});

test("listing text fits the store's limits and stays clear of Google's branding", () => {
  const name = resolveMessage(manifest.name);
  const description = resolveMessage(manifest.description);

  assert.ok(name.length <= 75, "name must be 75 characters or fewer");
  assert.ok(description.length <= 132, "description must be 132 characters or fewer, got " + description.length);
  assert.ok(manifest.short_name.length <= 12, "short_name must be 12 characters or fewer");

  // Naming an extension after another company's product invites a branding rejection;
  // referring to Scholar in the description is ordinary descriptive use and stays.
  assert.doesNotMatch(name, /\bgoogle\b/i, "keep Google out of the extension name");
  assert.doesNotMatch(manifest.short_name, /\bgoogle\b/i);
});

test("permissions stay minimal and every optional host is justified in the docs", () => {
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "scripting", "storage"]);
  assert.equal(manifest.host_permissions, undefined, "no install-time host permissions");

  const store = read("STORE.md");
  for (const permission of [...manifest.permissions, ...manifest.optional_host_permissions]) {
    assert.ok(store.includes(permission), "STORE.md must justify: " + permission);
  }
});

test("the packaged extension carries the documents a listing needs", () => {
  for (const file of ["README.md", "PRIVACY.md", "LICENSE", "CHANGELOG.md", "STORE.md"]) {
    assert.ok(existsSync(path.join(root, file)), "missing " + file);
  }
  assert.match(read("CHANGELOG.md"), new RegExp(manifest.version.replace(/\./g, "\\.")), "CHANGELOG is missing this version");
});

test("every locale defines the same message keys", () => {
  const locales = readdirSync(path.join(root, "_locales"));
  const base = Object.keys(messages).sort();
  for (const locale of locales) {
    const other = JSON.parse(read(path.join("_locales", locale, "messages.json")));
    assert.deepEqual(Object.keys(other).sort(), base, locale + " has a different set of messages");
  }
});

test("the PDF worker path resolves from the extension root, as getURL does", () => {
  const reader = read("src/pdfread.js");

  // chrome.runtime.getURL() resolves against the extension root, while a module import resolves
  // against the importing file. The same directory therefore has two different spellings, and
  // getting the worker's one wrong fails only at the moment a user opens a PDF.
  const worker = reader.match(/PDF_WORKER\s*=\s*"([^"]+)"/);
  assert.ok(worker, "pdfread.js must name a worker file");
  assert.ok(!worker[1].startsWith("./"), "a getURL path is root-relative, not module-relative");
  assert.ok(existsSync(path.join(root, worker[1])), "missing worker: " + worker[1]);

  const api = reader.match(/PDF_JS\s*=\s*"([^"]+)"/);
  assert.ok(api, "pdfread.js must name the pdf.js module");
  assert.ok(api[1].startsWith("./"), "an import is resolved against src/pdfread.js");
  assert.ok(existsSync(path.join(root, "src", api[1])), "missing pdf.js: " + api[1]);
});

test("the vendored library keeps its licence", () => {
  assert.ok(existsSync(path.join(root, "src/vendor/LICENSE")), "pdf.js is Apache-2.0; its licence must ship with it");
  assert.match(read("src/vendor/LICENSE"), /Apache License/);
});
