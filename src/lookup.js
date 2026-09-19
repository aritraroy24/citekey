/* Turning a shaky read of a PDF into a real record.

   Reading a citation off a page's layout goes wrong in ways that are obvious to a human and
   invisible to a heuristic: a subtitle swallowed into the author list, an affiliation read as a
   name, a running head mistaken for a journal. Rather than pile more rules on that, the fields
   are used as a query and a bibliographic database answers with the real record.

   The chain:

     1. A DOI in the document is identity — look it up and use it.
     2. No DOI: search both Crossref and OpenAlex by title, score every candidate against the
        title, authors and year the document gave, and take the best that clears the bar.
     3. A match that has a DOI is looked up again by that DOI, which returns the complete record
        rather than the subset a search result carries.

   Crossref and OpenAlex each hold works the other lacks — Crossref has only what publishers
   registered with it, OpenAlex indexes older workshop papers and preprints Crossref never saw —
   so both are asked and the better answer wins. Neither is treated as automatically right: the
   result carries a score and a list of what it disagrees with, and the popup asks before
   replacing anything. */

import { fetchCrossref, searchCrossref } from "./crossref.js";
import { fetchOpenAlexByDoi, searchOpenAlex, bestMatch, disagreementsBetween } from "./openalex.js";

export const LOOKUP_PERMISSION = {
  origins: ["https://api.crossref.org/*", "https://api.openalex.org/*"]
};

/** Ask both databases and keep whichever answers; a failure in one must not sink the other. */
async function settle(tasks) {
  const results = await Promise.allSettled(tasks.map((task) => task()));
  return {
    found: results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value),
    errors: results.filter((r) => r.status === "rejected").map((r) => r.reason && r.reason.message)
  };
}

/**
 * Resolve a record for `local`, which is whatever was read from the page or the PDF.
 * Returns { entry, via, score, disagreements } or null when nothing matched confidently.
 */
export async function resolveEntry(local, { fetchImpl = fetch, minSimilarity = 0.72 } = {}) {
  const doi = String((local && local.doi) || "").trim();

  if (doi) {
    // Identity: no scoring needed, and OpenAlex is asked first because its record carries the
    // venue and page numbers for conference papers that Crossref often leaves empty.
    const { found } = await settle([
      () => fetchOpenAlexByDoi(doi, fetchImpl),
      () => fetchCrossref(doi, fetchImpl)
    ]);
    if (!found.length) return null;

    const merged = mergeRecords(found);
    return { entry: merged, via: found.length > 1 ? "doi" : "doi", score: 1, disagreements: disagreementsBetween(local, merged) };
  }

  const { found } = await settle([
    () => searchOpenAlex(local, fetchImpl, { minSimilarity }),
    () => searchCrossref(local, fetchImpl, { minSimilarity })
  ]);
  if (!found.length) return null;

  // Score the two answers against each other on the same terms.
  const best = bestMatch(local, found, { minSimilarity: 0 });
  if (!best) return null;

  // Step 3: a search result is a summary. If it named a DOI, fetch the full record.
  if (best.doi) {
    const { found: complete } = await settle([
      () => fetchOpenAlexByDoi(best.doi, fetchImpl),
      () => fetchCrossref(best.doi, fetchImpl)
    ]);
    if (complete.length) {
      const merged = mergeRecords(complete);
      return {
        entry: merged,
        via: "search+doi",
        score: best.matchScore,
        disagreements: disagreementsBetween(local, merged)
      };
    }
  }

  return { entry: best, via: "search", score: best.matchScore, disagreements: best.disagreements || [] };
}

/** Combine records of the same work, preferring the first that filled each field. */
export function mergeRecords(records) {
  const out = { ...records[0] };
  for (const record of records.slice(1)) {
    for (const [field, value] of Object.entries(record)) {
      if (!out[field] && value) out[field] = value;
    }
    if (!(out.authors || []).length && (record.authors || []).length) out.authors = record.authors;
  }
  return out;
}
