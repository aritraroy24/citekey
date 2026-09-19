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

/* ---------- names ---------- */

const PARTICLES = ["van", "von", "de", "del", "della", "der", "den", "di", "da", "dos", "du", "la", "le", "bin", "ibn", "al", "ter", "ten", "st"];

const ORG_HINTS = /\b(inc|ltd|llc|plc|gmbh|corp|corporation|company|cloud|group|team|universit\w*|college|school|institute|laborator\w*|foundation|association|society|council|commission|ministry|department|agency|organi[sz]ation|consortium|press)\b/i;

/* Roman numerals stay as written: "Smith III" is not "Smith Iii". */
const ROMAN = /^(?:I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XI?V|XX)$/;

/**
 * Repair names a publisher shouted: "TETLOCK, PAUL C." becomes "Tetlock, Paul C.".
 *
 * Only runs of two or more capitals are touched, so initials ("C."), roman numerals ("III") and
 * names the author chose to write mixed ("MacDonald", "van der Maaten") are left exactly as they
 * are. Particles lowercase themselves, and "MCDONALD" gets its capital back.
 */
export function fixNameCaps(value) {
  return String(value || "").replace(/[^\s,]+/g, (token) => {
    if (ROMAN.test(token)) return token;
    if (!/[A-Z]{2,}/.test(token)) return token;

    const titled = token.replace(/[A-Z]{2,}/g, (run) => run[0] + run.slice(1).toLowerCase());
    const bare = titled.toLowerCase().replace(/\./g, "");
    if (PARTICLES.includes(bare)) return titled.toLowerCase();
    return titled.replace(/^Mc([a-z])/, (_, letter) => "Mc" + letter.toUpperCase());
  });
}

/**
 * Normalise a personal name to the "Last, First" order BibTeX expects, keeping name particles
 * with the surname and reading trailing initials ("Okafor CN") as initials rather than a surname.
 * Mirrors the logic in the injected extractor, which cannot import from here — it ships alone.
 */
export function toBibtexName(raw, options = {}) {
  const name = String(raw || "")
    // Typographic hyphens and non-breaking spaces come from publisher and API records alike.
    .replace(/[‐‑‒–]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(by|By)\s+/, "")
    .replace(/[;|,]\s*$/, "");
  if (!name) return null;

  // A lone run of capitals is an acronym — IEEE, NASA, WHO — not a shouted surname.
  const acronym = /^[A-Z]{2,6}$/.test(name);
  const corporate =
    options.corporate === true ||
    (options.corporate !== false && (acronym || (!name.includes(",") && ORG_HINTS.test(name))));
  // An organisation's capitals are its own: "IEEE" and "NASA" are not shouting.
  if (corporate) return { name, corporate: true };

  /* In a name written entirely in capitals every run of them is shouted. In a mixed one only the
     longer runs are — "Okafor CN" is a surname and initials, not a shouted "CN". */
  const shouted = !/[a-z]/.test(name);
  const fix = (part) => (shouted ? fixNameCaps(part) : part.replace(/\b[A-Z]{3,}\b/g, (run) => fixNameCaps(run)));

  if (name.includes(",")) {
    const [last, ...rest] = name.split(",");
    const given = rest.join(" ").replace(/\s+/g, " ").trim();
    return { name: given ? fix(last.trim()) + ", " + fix(given) : fix(last.trim()), corporate: false };
  }

  const parts = name.split(" ");
  if (parts.length === 1) return { name: fix(parts[0]), corporate: false };

  /* Trailing initials are kept exactly as written; they are not a shouted word. A three-letter
     run only counts as initials when it has no vowel — "MDS" is initials, "TAN" is a surname,
     and in an all-capitals name there is nothing else to tell them apart. */
  const tail = parts[parts.length - 1];
  const looksLikeInitials =
    /^(?:[A-Z]\.){1,3}$/.test(tail) || /^[A-Z]{1,2}$/.test(tail) || (/^[A-Z]{3}$/.test(tail) && !/[AEIOUY]/.test(tail));
  if (looksLikeInitials) {
    return { name: fix(parts.slice(0, -1).join(" ")) + ", " + tail, corporate: false };
  }

  let cut = parts.length - 1;
  while (cut > 1 && PARTICLES.includes(parts[cut - 1].toLowerCase().replace(/\./g, ""))) cut -= 1;
  return { name: fix(parts.slice(cut).join(" ")) + ", " + fix(parts.slice(0, cut).join(" ")), corporate: false };
}

/* ---------- matching ---------- */

const normaliseWords = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Word-overlap similarity, 0 to 1: enough to tell "the same paper" from "a different one". */
export function titleSimilarity(a, b) {
  const left = new Set(normaliseWords(a).split(" ").filter(Boolean));
  const right = new Set(normaliseWords(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

/** Surnames the two records agree on, as a fraction of the ones we started with. */
export function authorOverlap(mine, theirs) {
  const surname = (name) => normaliseWords(String(name || "").split(",")[0]).split(" ").pop();
  const wanted = (mine || []).map((a) => surname(a.name)).filter(Boolean);
  if (!wanted.length) return null;
  const found = new Set((theirs || []).map((a) => surname(a.name)).filter(Boolean));
  return wanted.filter((name) => found.has(name)).length / wanted.length;
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
