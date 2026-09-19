/* The lookup chain: what rescues a PDF whose layout cannot be read reliably.

   Every request is mocked. The shapes come from real Crossref and OpenAlex responses, including
   the awkward ones — OpenAlex's record for "Attention Is All You Need" really is dated 2025, and
   really does outrank the original in a title search. */

import test from "node:test";
import assert from "node:assert/strict";
import { openAlexToEntry, bestMatch, disagreementsBetween, searchOpenAlex, fetchOpenAlexByDoi } from "../src/openalex.js";
import { resolveEntry, mergeRecords } from "../src/lookup.js";
import { citationKey } from "../src/bibtex.js";

const openAlexWork = {
  id: "https://openalex.org/W123",
  display_name: "Computer simulation approach to the identification of visfatin-derived angiogenic peptides",
  doi: "https://doi.org/10.1371/journal.pone.0287577",
  type: "article",
  publication_year: 2023,
  cited_by_count: 12,
  authorships: [
    { raw_author_name: "Ji Myung Choi", author: { display_name: "Ji Myung Choi" } },
    { raw_author_name: "Ah-hwee Tan", author: { display_name: "Ah‐Hwee Tan" } }
  ],
  primary_location: {
    source: { display_name: "PLoS ONE", host_organization_name: "Public Library of Science", issn_l: "1932-6203" }
  },
  biblio: { volume: "18", issue: "6", first_page: "e0287577", last_page: "e0287577" }
};

/** A fetch stand-in that answers from a table of url fragment -> body. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        if (body === 404) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}

test("an OpenAlex work maps onto the entry shape", () => {
  const entry = openAlexToEntry(openAlexWork);
  assert.equal(entry.title, "Computer simulation approach to the identification of visfatin-derived angiogenic peptides");
  assert.equal(entry.journal, "PLoS ONE");
  assert.equal(entry.publisher, "Public Library of Science");
  assert.equal(entry.year, "2023");
  assert.equal(entry.volume, "18");
  assert.equal(entry.issue, "6");
  assert.equal(entry.pages, "e0287577", "one page is a page, not a range");
  assert.equal(entry.doi, "10.1371/journal.pone.0287577");
  assert.equal(entry.crossrefType, "article");

  // display_name has the better casing; its typographic hyphen does not belong in a .bib file.
  assert.equal(entry.authors[1].name, "Tan, Ah-Hwee");
  assert.equal(citationKey(entry), "choi2023computer");
  assert.equal(openAlexToEntry(null), null);
  assert.equal(openAlexToEntry({ display_name: "no id" }), null);
});

test("the right record wins when several share a title", () => {
  const local = { title: "Attention Is All You Need", authors: [{ name: "Vaswani, Ashish" }], year: "2017" };
  const candidates = [
    // What OpenAlex actually ranks first: a repost, from the wrong year.
    { title: "Attention Is All You Need", year: "2025", authors: [{ name: "Vaswani, Ashish" }], citedBy: 7566 },
    { title: "Attention Is All You Need", year: "2017", authors: [{ name: "Vaswani, Ashish" }], citedBy: 400 },
    { title: "Attention Is All You Need In Speech Separation", year: "2021", authors: [{ name: "Subakan, Cem" }], citedBy: 644 }
  ];

  const best = bestMatch(local, candidates);
  assert.equal(best.year, "2017", "the year the document carries decides between duplicates");
});

test("a different paper with a similar title is refused", () => {
  const local = { title: "Deep residual learning for image recognition", authors: [{ name: "He, Kaiming" }], year: "2016" };
  const candidates = [{ title: "Deep residual learning for image recognition", year: "2020", authors: [{ name: "Nobody, A." }] }];
  assert.equal(bestMatch(local, candidates), null, "no author in common means it is not the same work");
});

test("what a found record contradicts is reported, not hidden", () => {
  const notes = disagreementsBetween(
    { year: "2017", authors: [{ name: "Vaswani, Ashish" }, { name: "Shazeer, Noam" }], journal: "" },
    { year: "2025", authors: new Array(8).fill({ name: "X, Y" }), journal: "" }
  );
  assert.match(notes.join(" "), /year 2025, but the document says 2017/);
  assert.match(notes.join(" "), /8 authors, but the document shows 2/);
  assert.deepEqual(disagreementsBetween({ year: "2020" }, { year: "2020" }), []);
});

test("a DOI is looked up directly, in both databases", async () => {
  const fetchImpl = fakeFetch({
    "api.openalex.org/works/doi": openAlexWork,
    "api.crossref.org/works/": { message: { DOI: "10.1371/journal.pone.0287577", title: ["Computer simulation approach"], type: "journal-article", ISSN: ["1932-6203"] } }
  });

  const result = await resolveEntry({ doi: "10.1371/journal.pone.0287577", title: "Computer simulation approach" }, { fetchImpl });
  assert.equal(result.via, "doi");
  assert.equal(result.score, 1);
  assert.equal(result.entry.journal, "PLoS ONE");
  assert.ok(fetchImpl.calls.some((u) => u.includes("openalex")), "OpenAlex is asked");
  assert.ok(fetchImpl.calls.some((u) => u.includes("crossref")), "Crossref is asked too");
});

test("with no DOI, a title search that finds one fetches the full record", async () => {
  const searchHit = { ...openAlexWork, biblio: {}, primary_location: {} };
  const fetchImpl = fakeFetch({
    "api.openalex.org/works?": { results: [searchHit] },
    "api.crossref.org/works?": { message: { items: [] } },
    // Step three: the DOI from the search result is looked up for the complete record.
    "api.openalex.org/works/doi": openAlexWork,
    "api.crossref.org/works/10": 404
  });

  const result = await resolveEntry(
    { title: "Computer simulation approach to the identification of visfatin-derived angiogenic peptides", authors: [{ name: "Choi, Ji Myung" }] },
    { fetchImpl }
  );

  assert.equal(result.via, "search+doi");
  assert.equal(result.entry.journal, "PLoS ONE", "the fuller record replaced the search summary");
  assert.equal(result.entry.volume, "18");
});

test("nothing confident means nothing is returned", async () => {
  const fetchImpl = fakeFetch({ "works?": { results: [], message: { items: [] } } });
  const result = await resolveEntry({ title: "A paper nobody has ever indexed anywhere", authors: [] }, { fetchImpl });
  assert.equal(result, null);
});

test("one database failing does not sink the other", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("crossref")) throw new Error("network down");
    return { ok: true, status: 200, json: async () => openAlexWork };
  };
  const result = await resolveEntry({ doi: "10.1371/journal.pone.0287577" }, { fetchImpl });
  assert.equal(result.entry.journal, "PLoS ONE");
});

test("records of the same work combine without losing fields", () => {
  const merged = mergeRecords([
    { title: "A", journal: "", year: "2020", authors: [] },
    { title: "A", journal: "Nature", year: "2019", authors: [{ name: "Doe, J." }] }
  ]);
  assert.equal(merged.journal, "Nature", "a gap is filled from the second record");
  assert.equal(merged.year, "2020", "a field the first record answered is kept");
  assert.equal(merged.authors.length, 1, "an empty author list counts as a gap");
});

test("search and lookup refuse to run on nothing", async () => {
  await assert.rejects(() => searchOpenAlex({ title: "short" }, fakeFetch({})), /Not enough of a title/);
  await assert.rejects(() => fetchOpenAlexByDoi("", fakeFetch({})), /No DOI/);
});
