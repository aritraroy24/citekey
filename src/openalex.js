/* OpenAlex lookup.

   Crossref only knows works whose publisher registered a DOI with it, which leaves out most
   older workshop papers and a good deal of conference material — exactly the PDFs whose layout
   is hardest to read. OpenAlex indexes far more widely, so it is worth asking as well.

   It is not more authoritative, though. Its record for a heavily reposted paper can be a recent
   duplicate rather than the original, so what comes back is scored against what the document
   itself said and offered to the user, never applied behind their back. */

import { titleSimilarity, authorOverlap, toBibtexName } from "./entry.js";

export const OPENALEX_ORIGIN = "https://api.openalex.org/";
export const OPENALEX_PERMISSION = { origins: ["https://api.openalex.org/*"] };

/** OpenAlex work types mapped onto BibTeX entry types. */
const TYPE_MAP = {
  article: "article",
  "journal-article": "article",
  preprint: "misc",
  "posted-content": "misc",
  "conference-paper": "inproceedings",
  "proceedings-article": "inproceedings",
  proceedings: "inproceedings",
  "book-chapter": "incollection",
  book: "book",
  monograph: "book",
  dissertation: "phdthesis",
  report: "techreport",
  dataset: "misc",
  standard: "misc"
};

const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

const stripDoi = (value) => clean(value).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");

/** One OpenAlex work mapped onto the record shape the rest of the extension uses. */
export function openAlexToEntry(work) {
  if (!work || typeof work !== "object" || !work.id) return null;

  const authors = (work.authorships || [])
    .map((a) => {
      /* display_name is the better-cased of the two — OpenAlex's raw_author_name for this very
         paper is "Ah-hwee Tan" — but it is typeset with a U+2010 hyphen, which has no business
         in a .bib file. Take the casing and repair the punctuation. */
      const name = clean((a.author && a.author.display_name) || a.raw_author_name);
      return name ? toBibtexName(name) : null;
    })
    .filter(Boolean);

  const location = work.primary_location || (work.locations || [])[0] || {};
  const source = location.source || {};
  const biblio = work.biblio || {};

  const firstPage = clean(biblio.first_page);
  const lastPage = clean(biblio.last_page);
  const pages = firstPage && lastPage && firstPage !== lastPage ? firstPage + "--" + lastPage : firstPage;

  const type = TYPE_MAP[work.type] || "";
  const doi = stripDoi(work.doi);

  return {
    title: clean(work.display_name || work.title),
    authors,
    journal: clean(source.display_name),
    year: work.publication_year ? String(work.publication_year) : "",
    volume: clean(biblio.volume),
    issue: clean(biblio.issue),
    pages,
    publisher: clean(source.host_organization_name),
    doi,
    url: doi ? "https://doi.org/" + doi : clean(location.landing_page_url),
    issn: clean((source.issn_l || (source.issn || [])[0]) || ""),
    openAlexId: clean(work.id),
    citedBy: Number(work.cited_by_count) || 0,
    crossrefType: type,
    isConference: type === "inproceedings",
    isPreprint: work.type === "preprint" || work.type === "posted-content"
  };
}

async function readJson(response, what) {
  if (response.status === 404) throw new Error("OpenAlex has no record for " + what + ".");
  if (!response.ok) throw new Error("OpenAlex returned " + response.status + ".");
  return response.json();
}

/** Look a DOI up directly. This is identity, not a guess. */
export async function fetchOpenAlexByDoi(doi, fetchImpl = fetch) {
  const id = stripDoi(doi);
  if (!id) throw new Error("No DOI to look up.");

  const url = OPENALEX_ORIGIN + "works/doi:" + encodeURIComponent(id) + "?mailto=citekey-extension";
  const body = await readJson(await fetchImpl(url, { headers: { Accept: "application/json" } }), id);
  const entry = openAlexToEntry(body);
  if (!entry) throw new Error("OpenAlex returned an unexpected response.");
  return entry;
}

/**
 * Search by title, and score every candidate against what the document already told us.
 * Returns null rather than a guess when nothing agrees well enough.
 */
export async function searchOpenAlex(entry, fetchImpl = fetch, { minSimilarity = 0.72, rows = 8 } = {}) {
  const title = clean(entry && entry.title);
  if (title.length < 8) throw new Error("Not enough of a title to search OpenAlex with.");

  const url =
    OPENALEX_ORIGIN +
    "works?per-page=" + rows +
    "&sort=cited_by_count:desc" +
    "&filter=title.search:" + encodeURIComponent(title.replace(/[,:;]/g, " ")) +
    "&mailto=citekey-extension";

  const body = await readJson(await fetchImpl(url, { headers: { Accept: "application/json" } }), title);
  const candidates = ((body && body.results) || []).map(openAlexToEntry).filter(Boolean);
  return bestMatch(entry, candidates, { minSimilarity });
}

/**
 * Pick the candidate that best matches what we already know.
 *
 * Title similarity alone is what makes lookups pick the wrong paper: reposts and duplicates
 * share a title exactly. The author list has to agree, and the year the document itself carries
 * is a strong hint — a 2017 paper should not resolve to a 2025 record of the same name.
 */
export function bestMatch(local, candidates, { minSimilarity = 0.72 } = {}) {
  const title = clean(local && local.title);
  const localYear = Number(String((local && local.year) || "").match(/\d{4}/) || 0);

  const scored = (candidates || [])
    .map((candidate) => {
      const titleScore = titleSimilarity(title, candidate.title);
      const overlap = authorOverlap(local && local.authors, candidate.authors);
      const authorScore = overlap === null ? 0.5 : overlap;

      let yearScore = 0.5;
      if (localYear && candidate.year) {
        const gap = Math.abs(localYear - Number(candidate.year));
        yearScore = gap === 0 ? 1 : gap === 1 ? 0.7 : gap <= 3 ? 0.3 : 0;
      }

      return {
        candidate,
        titleScore,
        authorScore,
        yearScore,
        score: titleScore * 0.5 + authorScore * 0.3 + yearScore * 0.2
      };
    })
    .filter((row) => row.titleScore >= minSimilarity)
    // An author list that agrees on nothing means this is a different paper with the same title.
    .filter((row) => authorOverlap(local && local.authors, row.candidate.authors) !== 0)
    .sort((a, b) => b.score - a.score || Number(a.candidate.year || 9999) - Number(b.candidate.year || 9999));

  const best = scored[0];
  if (!best) return null;

  return {
    ...best.candidate,
    matchScore: Math.round(best.score * 100) / 100,
    disagreements: disagreementsBetween(local, best.candidate)
  };
}

/** What the found record says that the document did not — worth showing before applying it. */
export function disagreementsBetween(local, found) {
  const notes = [];
  if (!local || !found) return notes;

  const localYear = String(local.year || "").match(/\d{4}/);
  const foundYear = String(found.year || "").match(/\d{4}/);
  if (localYear && foundYear && localYear[0] !== foundYear[0]) {
    notes.push("year " + foundYear[0] + ", but the document says " + localYear[0]);
  }

  if (local.journal && found.journal && titleSimilarity(local.journal, found.journal) < 0.5) {
    notes.push("published in " + found.journal);
  }

  const localCount = (local.authors || []).length;
  const foundCount = (found.authors || []).length;
  if (localCount && foundCount && Math.abs(localCount - foundCount) > 1) {
    notes.push(foundCount + " authors, but the document shows " + localCount);
  }

  return notes;
}
