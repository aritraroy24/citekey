/* Pure helpers shared by the popup and the library page. Nothing here touches the DOM or the
   chrome.* APIs, so it can all be tested directly under node. */

/** Authors as editable text: one per line, an organisation wrapped in braces. */
export function authorsToText(authors) {
  return (authors || [])
    .filter((a) => a && a.name)
    .map((a) => (a.corporate ? "{" + a.name + "}" : a.name))
    .join("\n");
}

/** The inverse of authorsToText. */
export function textToAuthors(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const braced = line.match(/^\{(.*)\}$/);
      return braced
        ? { name: braced[1].trim(), corporate: true }
        : { name: line, corporate: false };
    })
    .filter((a) => a.name);
}

/** Two records describe the same source if any of their URLs agree. */
export function isSameSource(a, b) {
  const mine = [a && a.url, a && a.pageUrl].filter(Boolean);
  const theirs = [b && b.url, b && b.pageUrl].filter(Boolean);
  return mine.some((u) => theirs.includes(u));
}

/* ---------- settings ---------- */

export const THEMES = ["system", "light", "dark"];

/** Normalise a stored theme; anything unrecognised falls back to following the OS. */
export function resolveTheme(theme) {
  return THEMES.includes(theme) ? theme : "system";
}

export const DEFAULT_SETTINGS = {
  /** "system" leaves the page to prefers-color-scheme; "light"/"dark" pin it. */
  theme: "system",
  /** "auto" follows what the page declares; anything else pins the entry type. */
  type: "auto",
  /** "auto" pairs the Scholar layout with @article and the spaced layout with @online. */
  style: "auto",
  /** null means "follow the entry type"; true/false pin the toggle. */
  includeUrl: null,
  includeDoi: false,
  /** Keep a copy of every entry you copy or save, for the library page. */
  keepLibrary: true
};

export function mergeSettings(stored) {
  const out = { ...DEFAULT_SETTINGS };
  if (stored && typeof stored === "object") {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (stored[key] !== undefined) out[key] = stored[key];
    }
  }
  return out;
}

/** Resolve the saved preferences against what this particular page turned out to be. */
export function resolveChoices(settings, detectedType) {
  const s = mergeSettings(settings);
  const type = s.type === "auto" ? detectedType : s.type;
  const style = s.style === "auto" ? (type === "online" ? "spaced" : "scholar") : s.style;
  const includeUrl = s.includeUrl === null || s.includeUrl === undefined
    ? type === "online" || type === "misc"
    : Boolean(s.includeUrl);
  return { type, style, includeUrl, includeDoi: Boolean(s.includeDoi) };
}

/* ---------- library ---------- */

export const LIBRARY_LIMIT = 500;

/** Newest first, capped, one record per citation key. */
export function addToLibrary(library, record) {
  const next = { ...(library || {}) };
  next[record.key] = record;
  const keys = Object.keys(next);
  if (keys.length > LIBRARY_LIMIT) {
    keys
      .sort((a, b) => String(next[a].at || "").localeCompare(String(next[b].at || "")))
      .slice(0, keys.length - LIBRARY_LIMIT)
      .forEach((k) => delete next[k]);
  }
  return next;
}

export function librarySorted(library) {
  return Object.values(library || {}).sort((a, b) =>
    String(b.at || "").localeCompare(String(a.at || ""))
  );
}

/** Every stored entry as one .bib file. */
export function libraryToBib(library) {
  return librarySorted(library)
    .map((record) => record.bibtex)
    .filter(Boolean)
    .join("\n\n") + "\n";
}
