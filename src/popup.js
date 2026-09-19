import { citationKey, renderEntry, defaultType, today, warnings } from "./bibtex.js";
import {
  authorsToText,
  textToAuthors,
  isSameSource,
  mergeSettings,
  resolveChoices,
  resolveTheme,
  addToLibrary,
  DEFAULT_SETTINGS
} from "./entry.js";
import { fetchCrossref, mergeEntries, CROSSREF_PERMISSION } from "./crossref.js";

const $ = (id) => document.getElementById(id);

const els = {
  type: $("type"),
  style: $("style"),
  includeUrl: $("includeUrl"),
  includeDoi: $("includeDoi"),
  toggleFields: $("toggleFields"),
  fields: $("fields"),
  status: $("status"),
  statusText: $("statusText"),
  dupe: $("dupe"),
  dupeText: $("dupeText"),
  keyChip: $("keyChip"),
  themeButtons: Array.from(document.querySelectorAll("[data-theme-choice]")),
  crossrefRow: $("crossrefRow"),
  crossref: $("crossref"),
  output: $("output"),
  copy: $("copy"),
  download: $("download"),
  library: $("library"),
  reset: $("reset"),
  toast: $("toast"),
  key: $("f-key"),
  authors: $("f-authors"),
  title: $("f-title"),
  journal: $("f-journal"),
  year: $("f-year"),
  volume: $("f-volume"),
  issue: $("f-issue"),
  pages: $("f-pages"),
  publisher: $("f-publisher"),
  doi: $("f-doi"),
  url: $("f-url"),
  urldate: $("f-urldate")
};

const SETTINGS_KEY = "settings";
const LIBRARY_KEY = "library";

let entry = null;
let settings = { ...DEFAULT_SETTINGS };
let keyEdited = false;

/* ---------- storage ---------- */

async function loadSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return mergeSettings(stored[SETTINGS_KEY]);
}

/** Every change to the controls is a preference: the next popup opens the same way. */
async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

async function loadLibrary() {
  const stored = await chrome.storage.local.get(LIBRARY_KEY);
  return stored[LIBRARY_KEY] || {};
}

async function remember(key, current, bibtex) {
  if (!settings.keepLibrary) return;
  const library = await loadLibrary();
  await chrome.storage.local.set({
    [LIBRARY_KEY]: addToLibrary(library, {
      key,
      title: current.title,
      url: current.url,
      pageUrl: current.pageUrl,
      type: els.type.value,
      bibtex,
      at: new Date().toISOString()
    })
  });
}

/* ---------- page scraping ---------- */

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab.");
  if (!/^https?:/i.test(tab.url || "")) throw new Error("This page is not a web page the extension can read.");

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/extract.js"]
  });

  const data = results && results[0] && results[0].result;
  if (!data || !data.ok) throw new Error("Could not read metadata from this page.");
  return data;
}

/* ---------- form <-> entry ---------- */

function fillForm(data) {
  els.authors.value = authorsToText(data.authors);
  els.title.value = data.title || "";
  els.journal.value = data.journal || "";
  els.year.value = data.year || "";
  els.volume.value = data.volume || "";
  els.issue.value = data.issue || "";
  els.pages.value = data.pages || "";
  els.publisher.value = data.publisher || "";
  els.doi.value = data.doi || "";
  els.url.value = data.url || data.pageUrl || "";
  els.urldate.value = data.urldate || today();
}

function readForm() {
  return {
    authors: textToAuthors(els.authors.value),
    title: els.title.value.trim(),
    journal: els.journal.value.trim(),
    year: els.year.value.trim(),
    volume: els.volume.value.trim(),
    issue: els.issue.value.trim(),
    pages: els.pages.value.trim(),
    publisher: els.publisher.value.trim(),
    institution: entry ? entry.institution : "",
    isbn: entry ? entry.isbn : "",
    doi: els.doi.value.trim(),
    url: els.url.value.trim(),
    pageUrl: entry ? entry.pageUrl : "",
    urldate: els.urldate.value.trim(),
    isConference: entry ? entry.isConference : false,
    isPreprint: entry ? entry.isPreprint : false
  };
}

/* ---------- duplicates ---------- */

async function checkDuplicate(key, current) {
  const library = await loadLibrary();
  const seen = library[key];
  if (!seen || isSameSource(seen, current)) {
    els.dupe.hidden = true;
    return;
  }
  const when = seen.at ? new Date(seen.at).toLocaleDateString() : "earlier";
  els.dupeText.textContent =
    "Key " + key + " was already used on " + when + " for “" + (seen.title || "another page") + "”. Check before importing both.";
  els.dupe.hidden = false;
}

/* ---------- theme ---------- */

function applyTheme(theme) {
  const value = resolveTheme(theme);
  window.citekeyTheme.apply(value);
  for (const button of els.themeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === value));
  }
  return value;
}

/* ---------- rendering ---------- */

function render() {
  const current = readForm();
  const type = els.type.value;
  const key = keyEdited && els.key.value.trim() ? els.key.value.trim() : citationKey(current);
  if (!keyEdited) els.key.value = key;
  els.keyChip.textContent = key || "no key yet";

  const bibtex = renderEntry(current, {
    type,
    style: els.style.value,
    key,
    includeUrl: els.includeUrl.checked,
    includeDoi: els.includeDoi.checked
  });
  els.output.value = bibtex;
  fitOutput();

  const notes = warnings(current, type);
  els.statusText.textContent = notes.length
    ? notes.join(" ")
    : "Read from the page. This key matches the one Scholar would export.";
  els.status.classList.toggle("banner-warn", notes.length > 0);
  els.status.classList.toggle("banner-quiet", notes.length === 0);

  els.crossrefRow.hidden = !current.doi;

  checkDuplicate(key, current);
  return bibtex;
}

/** Grow the output box to the entry, up to the point where the popup itself would get unwieldy. */
function fitOutput() {
  els.output.style.height = "auto";
  els.output.style.height = Math.min(els.output.scrollHeight + 2, 320) + "px";
}

/** Write to the status banner, choosing the calm or the warning treatment. */
function say(message, tone) {
  els.statusText.textContent = message;
  els.status.classList.toggle("banner-warn", tone === "warn");
  els.status.classList.toggle("banner-quiet", tone !== "warn");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

/* ---------- Crossref ---------- */

async function enrichFromCrossref() {
  const current = readForm();
  if (!current.doi) return;

  const granted = await chrome.permissions.request(CROSSREF_PERMISSION);
  if (!granted) {
    say("Crossref lookup needs permission to reach api.crossref.org.", "warn");
    return;
  }

  els.crossref.disabled = true;
  say("Looking up " + current.doi + " on Crossref…");
  try {
    const looked = await fetchCrossref(current.doi);
    entry = mergeEntries({ ...entry, ...current }, looked);
    fillForm({ ...entry, urldate: els.urldate.value });
    if (looked.crossrefType && settings.type === "auto") els.type.value = looked.crossrefType;
    keyEdited = false;
    render();
    toast("Completed from Crossref.");
  } catch (error) {
    say(error.message, "warn");
  } finally {
    els.crossref.disabled = false;
  }
}

/* ---------- startup ---------- */

function applyChoices(detectedType) {
  const choices = resolveChoices(settings, detectedType);
  els.type.value = choices.type;
  els.style.value = choices.style;
  els.includeUrl.checked = choices.includeUrl;
  els.includeDoi.checked = choices.includeDoi;
}

async function init() {
  settings = await loadSettings();
  applyTheme(settings.theme);

  try {
    entry = await readActiveTab();
  } catch (error) {
    say(error.message + " You can still type the details in below.", "warn");
    showFields(true);
    entry = { authors: [], url: "", pageUrl: "", urldate: today() };
    fillForm(entry);
    applyChoices("online");
    render();
    return;
  }

  fillForm(entry);
  applyChoices(defaultType(entry));
  if (!entry.hasScholarTags) showFields(true);
  render();
}

function showFields(open) {
  els.fields.hidden = !open;
  els.toggleFields.setAttribute("aria-expanded", String(open));
  els.toggleFields.textContent = open ? "Hide fields" : "Edit fields";
}

/* ---------- events ---------- */

for (const el of [
  els.authors, els.title, els.journal, els.year, els.volume,
  els.issue, els.pages, els.publisher, els.doi, els.url, els.urldate
]) {
  el.addEventListener("input", render);
}

els.key.addEventListener("input", () => {
  keyEdited = els.key.value.trim().length > 0;
  render();
});

els.type.addEventListener("change", async () => {
  await saveSettings({ type: els.type.value });
  if (settings.style === "auto") els.style.value = els.type.value === "online" ? "spaced" : "scholar";
  if (settings.includeUrl === null) els.includeUrl.checked = ["online", "misc"].includes(els.type.value);
  render();
});

els.style.addEventListener("change", async () => {
  await saveSettings({ style: els.style.value });
  render();
});

els.includeDoi.addEventListener("change", async () => {
  await saveSettings({ includeDoi: els.includeDoi.checked });
  render();
});

els.includeUrl.addEventListener("change", async () => {
  await saveSettings({ includeUrl: els.includeUrl.checked });
  render();
});

for (const button of els.themeButtons) {
  button.addEventListener("click", async () => {
    const theme = applyTheme(button.dataset.themeChoice);
    await saveSettings({ theme });
  });
}

els.keyChip.addEventListener("click", async () => {
  const key = els.key.value.trim();
  if (!key) return;
  await navigator.clipboard.writeText(key);
  toast("Key copied.");
});

els.toggleFields.addEventListener("click", () => showFields(els.fields.hidden));

els.crossref.addEventListener("click", enrichFromCrossref);

els.library.addEventListener("click", () => chrome.runtime.openOptionsPage());

els.reset.addEventListener("click", async () => {
  keyEdited = false;
  await init();
});

els.copy.addEventListener("click", async () => {
  const bibtex = els.output.value;
  await navigator.clipboard.writeText(bibtex);
  await remember(els.key.value.trim(), readForm(), bibtex);
  toast("Copied.");
});

els.download.addEventListener("click", async () => {
  const bibtex = els.output.value;
  const key = els.key.value.trim() || "entry";
  const blob = new Blob([bibtex + "\n"], { type: "application/x-bibtex" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = key + ".bib";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  await remember(key, readForm(), bibtex);
  toast("Saved " + key + ".bib");
});

init();
