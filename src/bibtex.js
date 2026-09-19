/* Citation-key generation and BibTeX rendering.

   The key algorithm reproduces what Google Scholar puts in its "BibTeX" export:
   first author's surname + publication year + first non-trivial word of the title,
   all lowercased and reduced to ASCII alphanumerics. Matching it exactly is the point
   of this extension: Zotero, JabRef and BibDesk all dedupe on the entry key, so an
   entry generated here collides with the same paper imported from Scholar. */

/** Words Scholar skips when it looks for the title word of a key. */
export const KEY_STOPWORDS = new Set([
  "a", "an", "the",
  "on", "of", "in", "into", "for", "from", "to", "with", "at", "by", "as",
  "and", "or", "nor",
  "is", "are", "was", "were", "be", "been", "being",
  "over", "under", "about"
]);

const DIACRITICS = /[̀-ͯ]/g;

/** Fold accents and typographic oddities down to plain ASCII, the way Scholar's keys are. */
export function toAscii(input) {
  return String(input || "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[ß]/g, "ss")
    .replace(/[æ]/gi, "ae")
    .replace(/[œ]/gi, "oe")
    .replace(/[øØ]/g, "o")
    .replace(/[đĐ]/g, "d")
    .replace(/[łŁ]/g, "l")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
}

const alnum = (s) => toAscii(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** The surname token Scholar keys on: first word of the family-name part. */
export function keyAuthorPart(authors) {
  const first = (authors || []).find((a) => a && a.name);
  if (!first) return "";
  const name = String(first.name);
  const surname = name.includes(",") ? name.split(",")[0] : name;
  const token = toAscii(surname).trim().split(/\s+/)[0] || "";
  return alnum(token);
}

/** The title word Scholar keys on: first word that is not an article or short preposition. */
export function keyTitlePart(title) {
  const words = toAscii(title)
    .replace(/[{}\\$]/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return "";
  for (const w of words) {
    const lower = w.toLowerCase();
    if (!KEY_STOPWORDS.has(lower)) return alnum(lower);
  }
  return alnum(words[0]);
}

export function citationKey(entry) {
  const year = String(entry.year || "").match(/\d{4}/);
  return keyAuthorPart(entry.authors) + (year ? year[0] : "") + keyTitlePart(entry.title);
}

/* ---------- rendering ---------- */

const ESCAPES = [
  [/\\/g, "\\textbackslash{}"],
  [/([&%$#_])/g, "\\$1"],
  [/~/g, "\\textasciitilde{}"],
  [/\^/g, "\\textasciicircum{}"]
];

/** Escape BibTeX specials. Braces are dropped rather than escaped: they only ever arrive
    from stray markup, and an unbalanced brace breaks the whole .bib file. */
export function escapeValue(value) {
  let out = String(value == null ? "" : value).replace(/[{}]/g, "");
  for (const [re, to] of ESCAPES) out = out.replace(re, to);
  return out.trim();
}

/** "Last, First and Other, Name"; organisations get the extra braces that keep BibTeX
    from reading the name as "First Last" and reordering or abbreviating it. */
export function formatAuthors(authors) {
  return (authors || [])
    .filter((a) => a && a.name)
    .map((a) => (a.corporate ? "{" + escapeValue(a.name) + "}" : escapeValue(a.name)))
    .join(" and ");
}

export const ENTRY_FIELDS = {
  // Scholar's own field order for journal articles, so diffs against its export stay small.
  article: ["title", "author", "journal", "volume", "number", "pages", "year", "publisher", "doi", "url", "urldate"],
  online: ["author", "title", "year", "url", "urldate", "note"],
  misc: ["title", "author", "howpublished", "year", "url", "urldate", "note"],
  inproceedings: ["title", "author", "booktitle", "pages", "year", "organization", "publisher", "doi", "url", "urldate"],
  incollection: ["title", "author", "booktitle", "publisher", "pages", "year", "doi", "url", "urldate"],
  book: ["title", "author", "publisher", "year", "isbn", "url", "urldate"],
  techreport: ["title", "author", "institution", "year", "number", "url", "urldate"],
  phdthesis: ["title", "author", "school", "year", "url", "urldate"]
};

/** Map the scraped record onto BibTeX field names for one entry type. */
export function fieldsFor(entry, type) {
  const values = {
    author: formatAuthors(entry.authors),
    title: escapeValue(entry.title),
    journal: escapeValue(entry.journal),
    booktitle: escapeValue(entry.journal),
    volume: escapeValue(entry.volume),
    number: escapeValue(entry.issue),
    pages: escapeValue(entry.pages).replace(/\s*-{1,3}\s*/, "--"),
    year: (String(entry.year || "").match(/\d{4}/) || [""])[0],
    publisher: escapeValue(entry.publisher),
    organization: escapeValue(entry.publisher),
    institution: escapeValue(entry.institution || entry.publisher),
    school: escapeValue(entry.institution || entry.publisher),
    isbn: escapeValue(entry.isbn),
    doi: escapeValue(entry.doi),
    url: escapeValue(entry.url),
    urldate: escapeValue(entry.urldate),
    howpublished: entry.url ? "\\url{" + escapeValue(entry.url) + "}" : "",
    note: escapeValue(entry.note)
  };

  const order = ENTRY_FIELDS[type] || ENTRY_FIELDS.misc;
  return order
    .filter((f) => values[f])
    .map((f) => ({ field: f, value: values[f] }));
}

/**
 * Render a BibTeX entry.
 * options.style: "scholar" -> title={x}, Scholar's own compact spacing;
 *                "spaced"  -> author = {x}, the layout in the @online example.
 * options.includeUrl / includeDoi drop those fields from types where they are optional extras.
 */
export function renderEntry(entry, options = {}) {
  const type = options.type || defaultType(entry);
  const style = options.style || (type === "online" ? "spaced" : "scholar");
  const key = options.key || citationKey(entry);

  let fields = fieldsFor(entry, type);
  if (options.includeDoi === false) fields = fields.filter((f) => f.field !== "doi");
  if (options.includeUrl === false) fields = fields.filter((f) => !["url", "urldate", "howpublished"].includes(f.field));

  const pad = style === "spaced" ? "  " : "  ";
  const sep = style === "spaced" ? " = " : "=";
  const body = fields.map((f) => pad + f.field + sep + "{" + f.value + "}").join(",\n");

  return "@" + type + "{" + key + ",\n" + body + "\n}";
}

/** Best guess at the entry type from what the page actually advertised. */
export function defaultType(entry) {
  if (entry.isConference) return "inproceedings";
  if (entry.journal) return "article";
  if (entry.isPreprint) return "misc";
  return "online";
}

/** Today in YYYY-MM-DD, local time — the urldate for an @online entry. */
export function today(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate());
}

/** Things worth telling the user about before they paste this into their library. */
export function warnings(entry, type) {
  const out = [];
  if (!entry.authors || !entry.authors.length) out.push("No author found — the key will start with the year.");
  if (!entry.year) out.push("No year found — Scholar's key for this paper will not match.");
  if (!entry.title) out.push("No title found.");
  if (type === "article" && !entry.journal) out.push("No journal name found for an @article entry.");
  return out;
}
