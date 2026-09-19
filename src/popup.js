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
import { resolveEntry, LOOKUP_PERMISSION } from "./lookup.js";
import { readPdf } from "./pdfread.js";
import { pdfToEntry } from "./pdfmeta.js";
import { bytesForTab, bytesFromFile, looksLikePdfUrl } from "./pdfsource.js";

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
  crossrefSearch: $("crossrefSearch"),
  pdfPanel: $("pdfPanel"),
  pdfStatus: $("pdfStatus"),
  readPdf: $("readPdf"),
  pdfFile: $("pdfFile"),
  pdfPages: $("pdfPages"),
  matchPanel: $("matchPanel"),
  matchText: $("matchText"),
  matchNotes: $("matchNotes"),
  matchApply: $("matchApply"),
  matchDismiss: $("matchDismiss"),
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
let activeTab = null;
let pendingMatch = null;
/** True once the entry came out of a PDF rather than a page's metadata. */
let fromPdf = false;

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
  activeTab = tab || null;
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
    isPreprint: entry ? entry.isPreprint : false,
    eprint: entry ? entry.eprint : "",
    primaryClass: entry ? entry.primaryClass : ""
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

/** How the popup describes where a field came from, when the answer is "we guessed". */
const CONFIDENCE_NOTE = {
  high: "Read from the PDF's own metadata — worth a glance, but it should be right.",
  medium: "Worked out from the first pages. Check the title, authors and venue before you copy.",
  low: "Little to go on in this PDF. Treat every field as a draft."
};

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
  if (!fromPdf && !els.pdfPanel.hidden) {
    say("This tab is a PDF, so there are no citation tags to read. Read the file to build the entry.");
  } else if (notes.length) {
    say(notes.join(" "), "warn");
  } else if (fromPdf) {
    say(CONFIDENCE_NOTE[(entry && entry.confidence) || "low"], (entry && entry.confidence) === "high" ? "" : "warn");
  } else {
    say("Read from the page. This key matches the one Scholar would export.");
  }

  // One row, two actions: look a DOI up, or search by title when the PDF had no DOI to use.
  const searchable = fromPdf && current.title.length > 8;
  els.crossref.hidden = !current.doi;
  els.crossrefSearch.hidden = Boolean(current.doi) || !searchable;
  els.crossrefRow.hidden = Boolean(current.doi) === false && !searchable;

  checkDuplicate(key, current);
  return bibtex;
}

/** Size the output box to the entry, so it never scrolls inside its own frame. */
function fitOutput() {
  els.output.style.height = "auto";
  els.output.style.height = Math.max(els.output.scrollHeight + 2, 96) + "px";
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


/* ---------- PDF ---------- */

function showPdfPanel(show, message) {
  els.pdfPanel.hidden = !show;
  if (message) els.pdfStatus.textContent = message;
}

/** Parse PDF bytes and put what they say into the form. */
async function usePdfBytes(bytes, { label }) {
  const maxPages = Number(els.pdfPages.value) || 3;
  say("Reading " + label + "…");

  const parsed = await readPdf(bytes, { maxPages });
  const found = pdfToEntry(parsed, { url: (activeTab && activeTab.url) || "" });

  if (!found.title && !(found.authors || []).length) {
    throw new Error("Nothing citable found in the first " + maxPages + " pages. Try reading more pages.");
  }

  entry = { ...found, pageUrl: (activeTab && activeTab.url) || "" };
  fromPdf = true;
  fillForm({ ...entry, urldate: today() });
  if (settings.type === "auto" && found.suggestedType) els.type.value = found.suggestedType;
  keyEdited = false;
  render();

  showPdfPanel(true, "Read " + Math.min(maxPages, parsed.pageCount) + " of " + parsed.pageCount +
    (parsed.pageCount === 1 ? " page." : " pages.") + " Change the count and read again if the entry looks thin.");
}

async function readPdfFromTab() {
  els.readPdf.disabled = true;
  try {
    const { bytes } = await bytesForTab(activeTab);
    await usePdfBytes(bytes, { label: "the PDF" });
  } catch (error) {
    say(error.message + " You can open the file instead.", "warn");
  } finally {
    els.readPdf.disabled = false;
  }
}

/* ---------- Crossref match confirmation ---------- */

/** A DOI is identity, so it applies straight away; a title search is a guess and is offered. */
function offerMatch(found, result = {}) {
  pendingMatch = found;

  const where = found.journal ? ", " + found.journal : "";
  const summary = found.title + (found.year ? " (" + found.year + ")" : "") + where;
  const confidence = result.via === "doi" ? "matched by DOI" : "match " + Math.round((result.score || 0) * 100) + "%";

  els.matchText.textContent = "Found: " + summary + " — " + confidence + ".";

  /* Where the record contradicts the document, say so rather than quietly overwriting: a
     heavily reposted paper often resolves to a duplicate from the wrong year. */
  const notes = result.disagreements || [];
  els.matchNotes.textContent = notes.length ? "Differs from the document: " + notes.join("; ") + "." : "";
  els.matchNotes.hidden = notes.length === 0;
  els.matchPanel.hidden = false;
}

/**
 * Look the paper up by what we have. Reading a citation off a PDF's layout is guesswork; a
 * bibliographic database knows the answer. Crossref and OpenAlex are both asked, because each
 * holds works the other does not.
 */
async function lookUpEntry() {
  const granted = await chrome.permissions.request(LOOKUP_PERMISSION);
  if (!granted) {
    say("Looking the paper up needs permission to reach Crossref and OpenAlex.", "warn");
    return;
  }

  els.crossrefSearch.disabled = true;
  say("Looking this paper up…");
  try {
    const found = await resolveEntry(readForm());
    if (!found) {
      say("No confident match in Crossref or OpenAlex. The fields below are what the document says.", "warn");
      return;
    }
    offerMatch(found.entry, found);
    say("Found a record — check it before applying.");
  } catch (error) {
    say(error.message, "warn");
  } finally {
    els.crossrefSearch.disabled = false;
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

  const isPdf = entry.isPdf || looksLikePdfUrl(activeTab && activeTab.url);
  // The PDF viewer reports the file name as the document title; blank it rather than seeding
  // the entry with "1706.03762v7.pdf".
  if (isPdf && /\.pdf$/i.test(entry.title || "")) entry = { ...entry, title: "" };
  fillForm(entry);
  applyChoices(isPdf ? "misc" : defaultType(entry));

  if (isPdf) {
    showPdfPanel(true);
    say("This tab is a PDF, so there are no citation tags to read. Read the file to build the entry.");
    render();
    return;
  }

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
els.crossrefSearch.addEventListener("click", lookUpEntry);
els.readPdf.addEventListener("click", readPdfFromTab);

els.pdfFile.addEventListener("change", async () => {
  const file = els.pdfFile.files && els.pdfFile.files[0];
  if (!file) return;
  try {
    await usePdfBytes(await bytesFromFile(file), { label: file.name });
  } catch (error) {
    say(error.message, "warn");
  } finally {
    els.pdfFile.value = "";
  }
});

els.matchApply.addEventListener("click", () => {
  if (!pendingMatch) return;
  entry = mergeEntries({ ...entry, ...readForm() }, pendingMatch);
  fillForm({ ...entry, urldate: els.urldate.value });
  if (pendingMatch.crossrefType && settings.type === "auto") els.type.value = pendingMatch.crossrefType;
  pendingMatch = null;
  els.matchPanel.hidden = true;
  keyEdited = false;
  render();
  toast("Applied the Crossref record.");
});

els.matchDismiss.addEventListener("click", () => {
  pendingMatch = null;
  els.matchPanel.hidden = true;
});

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
