/* Crossref lookup. A DOI is often the only thing a PDF viewer or an older journal page gives up;
   Crossref turns it into the authoritative author list, journal, volume, issue, pages and year.

   The host permission is optional and requested the first time the user asks for a lookup, so the
   install-time prompt stays limited to "read the page you clicked on". */

export const CROSSREF_ORIGIN = "https://api.crossref.org/";
export const CROSSREF_PERMISSION = { origins: ["https://api.crossref.org/*"] };

const TYPE_MAP = {
  "journal-article": "article",
  "proceedings-article": "inproceedings",
  "book-chapter": "incollection",
  "book": "book",
  "monograph": "book",
  "report": "techreport",
  "dissertation": "phdthesis",
  "posted-content": "misc"
};

const first = (value) => (Array.isArray(value) ? value[0] : value);

const yearOf = (work) => {
  for (const key of ["published-print", "published-online", "published", "issued", "created"]) {
    const parts = work[key] && work[key]["date-parts"] && work[key]["date-parts"][0];
    if (parts && parts[0]) return String(parts[0]);
  }
  return "";
};

/** Crossref's `message` object mapped onto the record shape the rest of the extension uses. */
export function crossrefToEntry(work) {
  if (!work || typeof work !== "object") return null;

  const authors = (work.author || [])
    .map((a) => {
      if (a.name) return { name: a.name, corporate: true };
      if (a.family) return { name: a.given ? a.family + ", " + a.given : a.family, corporate: false };
      return null;
    })
    .filter(Boolean);

  const type = TYPE_MAP[work.type] || "";

  return {
    title: String(first(work.title) || "").replace(/\s+/g, " ").trim(),
    authors,
    journal: String(first(work["container-title"]) || "").replace(/\s+/g, " ").trim(),
    year: yearOf(work),
    volume: String(work.volume || ""),
    issue: String(work.issue || ""),
    pages: String(work.page || "").replace(/\s*[-–—]+\s*/, "--"),
    publisher: String(work.publisher || ""),
    doi: String(work.DOI || ""),
    url: String(work.URL || (work.DOI ? "https://doi.org/" + work.DOI : "")),
    issn: String(first(work.ISSN) || ""),
    isbn: String(first(work.ISBN) || ""),
    crossrefType: type,
    isConference: work.type === "proceedings-article",
    isPreprint: work.type === "posted-content"
  };
}

/** Keep whatever the page already gave us; Crossref only fills the gaps. */
export function mergeEntries(pageEntry, crossrefEntry, { preferCrossref = true } = {}) {
  if (!crossrefEntry) return pageEntry;
  const out = { ...pageEntry };
  const scalar = ["title", "journal", "year", "volume", "issue", "pages", "publisher", "doi", "issn", "isbn"];

  for (const field of scalar) {
    const incoming = crossrefEntry[field];
    if (!incoming) continue;
    if (preferCrossref || !out[field]) out[field] = incoming;
  }
  if (crossrefEntry.authors && crossrefEntry.authors.length && (preferCrossref || !(out.authors || []).length)) {
    out.authors = crossrefEntry.authors;
  }
  // The URL the reader actually used is more useful than Crossref's doi.org redirect.
  if (!out.url) out.url = crossrefEntry.url;
  if (crossrefEntry.isConference) out.isConference = true;
  if (crossrefEntry.isPreprint) out.isPreprint = true;
  return out;
}

/** Fetch one DOI. `mailto` is Crossref's requested etiquette for identifying a client. */
export async function fetchCrossref(doi, fetchImpl = fetch) {
  const clean = String(doi || "").replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, "").trim();
  if (!clean) throw new Error("No DOI to look up.");

  const url = CROSSREF_ORIGIN + "works/" + encodeURIComponent(clean) + "?mailto=citekey-extension";
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (response.status === 404) throw new Error("Crossref has no record for " + clean + ".");
  if (!response.ok) throw new Error("Crossref returned " + response.status + ".");

  const body = await response.json();
  const entry = crossrefToEntry(body && body.message);
  if (!entry) throw new Error("Crossref returned an unexpected response.");
  return entry;
}

/* ---------- search ---------- */

const normalise = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Word-overlap similarity, 0 to 1. Good enough to tell "the same paper" from "a different one". */
export function titleSimilarity(a, b) {
  const left = new Set(normalise(a).split(" ").filter(Boolean));
  const right = new Set(normalise(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

/**
 * Find a work by title and author when the PDF carries no DOI — which is the case for most
 * older conference papers and anything scanned. Returns null rather than a bad guess when
 * nothing comes back close enough to the title we started from.
 */
export async function searchCrossref(entry, fetchImpl = fetch, { minSimilarity = 0.72 } = {}) {
  const title = String((entry && entry.title) || "").trim();
  if (title.length < 8) throw new Error("Not enough of a title to search Crossref with.");

  const author = (entry.authors || [])[0];
  const surname = author ? String(author.name).split(",")[0] : "";
  const query = [title, surname].filter(Boolean).join(" ");

  const url =
    CROSSREF_ORIGIN +
    "works?rows=5&select=DOI,title,container-title,author,issued,published-print,published-online,volume,issue,page,publisher,type,URL,ISSN,ISBN" +
    "&query.bibliographic=" +
    encodeURIComponent(query) +
    "&mailto=citekey-extension";

  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Crossref returned " + response.status + ".");

  const body = await response.json();
  const items = (body && body.message && body.message.items) || [];

  /* Title alone is not enough to identify a work: reposts, errata and unrelated records share
     titles, and a search for a 2017 conference paper will happily return a 2025 duplicate. The
     author list has to agree too, and where several records still tie, the earliest is the
     original rather than a later reissue. */
  const wanted = (entry.authors || []).map((a) => normalise(String(a.name).split(",")[0])).filter(Boolean);

  const scored = items
    .map((item) => {
      const score = titleSimilarity(title, Array.isArray(item.title) ? item.title[0] : item.title);
      const surnames = (item.author || []).map((a) => normalise(a.family || a.name || ""));
      const shared = wanted.filter((name) => surnames.includes(name)).length;
      const authorScore = wanted.length ? shared / wanted.length : 0;
      return { item, score, authorScore, year: Number(yearOf(item)) || 9999 };
    })
    .filter((candidate) => candidate.score >= minSimilarity)
    .filter((candidate) => !wanted.length || candidate.authorScore > 0)
    .sort((a, b) => b.score + b.authorScore - (a.score + a.authorScore) || a.year - b.year);

  const best = scored[0];
  if (!best) return null;

  const found = crossrefToEntry(best.item);
  return found
    ? { ...found, matchScore: Math.round((best.score + best.authorScore) / (wanted.length ? 2 : 1) * 100) / 100 }
    : null;
}
