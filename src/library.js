import { librarySorted, libraryToBib, mergeSettings, DEFAULT_SETTINGS } from "./entry.js";

const $ = (id) => document.getElementById(id);

const els = {
  keepLibrary: $("keepLibrary"),
  defaultType: $("defaultType"),
  defaultStyle: $("defaultStyle"),
  search: $("search"),
  exportAll: $("exportAll"),
  clear: $("clear"),
  count: $("count"),
  entries: $("entries"),
  template: $("entryTemplate"),
  toast: $("toast")
};

const SETTINGS_KEY = "settings";
const LIBRARY_KEY = "library";

let library = {};
let settings = { ...DEFAULT_SETTINGS };

const loadLibrary = async () => (await chrome.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY] || {};
const saveLibrary = (next) => chrome.storage.local.set({ [LIBRARY_KEY]: next });

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

function download(filename, contents) {
  const blob = new Blob([contents], { type: "application/x-bibtex" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function matches(record, needle) {
  if (!needle) return true;
  const hay = [record.key, record.title, record.url, record.pageUrl].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(needle);
}

function renderList() {
  const needle = els.search.value.trim().toLowerCase();
  const all = librarySorted(library);
  const shown = all.filter((record) => matches(record, needle));

  els.entries.replaceChildren();
  for (const record of shown) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.querySelector(".entry-key").textContent = record.key;
    node.querySelector(".entry-type").textContent = record.type ? "@" + record.type : "";
    const when = node.querySelector(".entry-date");
    if (record.at) {
      when.dateTime = record.at;
      when.textContent = new Date(record.at).toLocaleDateString();
    }
    node.querySelector(".entry-title").textContent = record.title || "(no title)";
    const link = node.querySelector(".entry-url");
    const href = record.url || record.pageUrl || "";
    if (href) {
      link.href = href;
      link.textContent = href;
    } else {
      link.remove();
    }
    node.querySelector(".entry-bib").textContent = record.bibtex || "";

    node.querySelector(".entry-copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(record.bibtex || "");
      toast("Copied " + record.key + ".");
    });
    node.querySelector(".entry-delete").addEventListener("click", async () => {
      delete library[record.key];
      await saveLibrary(library);
      renderList();
      toast("Deleted " + record.key + ".");
    });

    els.entries.append(node);
  }

  const total = all.length;
  els.count.textContent = total === 0
    ? "Nothing saved yet. Entries land here when you copy or save one from the popup."
    : shown.length === total
      ? total + (total === 1 ? " entry" : " entries")
      : shown.length + " of " + total + " entries";
  els.exportAll.disabled = shown.length === 0;
}

async function init() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  settings = mergeSettings(stored[SETTINGS_KEY]);
  els.keepLibrary.checked = settings.keepLibrary;
  els.defaultType.value = settings.type;
  els.defaultStyle.value = settings.style;

  library = await loadLibrary();
  renderList();
}

els.keepLibrary.addEventListener("change", () => saveSettings({ keepLibrary: els.keepLibrary.checked }));
els.defaultType.addEventListener("change", () => saveSettings({ type: els.defaultType.value }));
els.defaultStyle.addEventListener("change", () => saveSettings({ style: els.defaultStyle.value }));
els.search.addEventListener("input", renderList);

els.exportAll.addEventListener("click", () => {
  const needle = els.search.value.trim().toLowerCase();
  const filtered = {};
  for (const record of librarySorted(library)) {
    if (matches(record, needle)) filtered[record.key] = record;
  }
  download("citekey-library.bib", libraryToBib(filtered));
  toast("Exported .bib");
});

els.clear.addEventListener("click", async () => {
  if (!confirm("Delete every saved entry? This also clears the duplicate-warning history.")) return;
  library = {};
  await saveLibrary(library);
  renderList();
  toast("Library cleared.");
});

init();
