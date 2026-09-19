import test from "node:test";
import assert from "node:assert/strict";
import { crossrefToEntry, mergeEntries, fetchCrossref } from "../src/crossref.js";
import { citationKey, renderEntry } from "../src/bibtex.js";

const work = {
  DOI: "10.1016/j.patter.2021.100232",
  type: "journal-article",
  title: ["Machine learning for materials discovery"],
  "container-title": ["Patterns"],
  author: [
    { given: "Riya S.", family: "Patel" },
    { given: "Johan", family: "van der Berg" },
    { name: "The Materials Project" }
  ],
  "published-print": { "date-parts": [[2021, 6, 11]] },
  volume: "2",
  issue: "6",
  page: "100232-100244",
  publisher: "Elsevier BV",
  URL: "https://doi.org/10.1016/j.patter.2021.100232",
  ISSN: ["2666-3899"]
};

test("maps a Crossref work onto the extension's record shape", () => {
  const entry = crossrefToEntry(work);
  assert.equal(entry.title, "Machine learning for materials discovery");
  assert.deepEqual(entry.authors, [
    { name: "Patel, Riya S.", corporate: false },
    { name: "van der Berg, Johan", corporate: false },
    { name: "The Materials Project", corporate: true }
  ]);
  assert.equal(entry.journal, "Patterns");
  assert.equal(entry.year, "2021");
  assert.equal(entry.pages, "100232--100244");
  assert.equal(entry.crossrefType, "article");
  assert.equal(citationKey(entry), "patel2021machine");
  assert.equal(crossrefToEntry(null), null);
});

test("falls through the date fields when there is no print date", () => {
  assert.equal(crossrefToEntry({ "published-online": { "date-parts": [[2019, 3]] } }).year, "2019");
  assert.equal(crossrefToEntry({ created: { "date-parts": [[2015]] } }).year, "2015");
  assert.equal(crossrefToEntry({}).year, "");
});

test("preprints and conference papers keep their entry type", () => {
  assert.equal(crossrefToEntry({ type: "posted-content" }).isPreprint, true);
  assert.equal(crossrefToEntry({ type: "proceedings-article" }).crossrefType, "inproceedings");
  assert.equal(crossrefToEntry({ type: "book-chapter" }).crossrefType, "incollection");
});

test("merging fills the gaps a PDF viewer left and keeps the reader's URL", () => {
  const fromPage = {
    title: "Machine learning for materials discovery",
    authors: [],
    doi: "10.1016/j.patter.2021.100232",
    url: "https://www.sciencedirect.com/science/article/pii/S2666389921000969",
    pageUrl: "https://www.sciencedirect.com/science/article/pii/S2666389921000969",
    urldate: "2026-09-19"
  };
  const merged = mergeEntries(fromPage, crossrefToEntry(work));

  assert.equal(merged.journal, "Patterns");
  assert.equal(merged.volume, "2");
  assert.equal(merged.authors.length, 3);
  assert.equal(merged.url, fromPage.url, "the page the reader actually used wins over doi.org");
  assert.equal(merged.urldate, "2026-09-19", "fields Crossref knows nothing about survive");
  assert.match(renderEntry(merged, { type: "article" }), /^@article\{patel2021machine,/);
});

test("merge is a no-op without a Crossref record", () => {
  const page = { title: "x", authors: [] };
  assert.equal(mergeEntries(page, null), page);
});

test("fetchCrossref cleans the DOI and reports failures in plain words", async () => {
  let requested = "";
  const ok = async (url) => {
    requested = url;
    return { ok: true, status: 200, json: async () => ({ message: work }) };
  };
  const entry = await fetchCrossref("https://doi.org/10.1016/j.patter.2021.100232", ok);
  assert.equal(entry.journal, "Patterns");
  assert.match(requested, /^https:\/\/api\.crossref\.org\/works\/10\.1016%2Fj\.patter\.2021\.100232\?/);

  const missing = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(() => fetchCrossref("10.0/nope", missing), /no record for 10\.0\/nope/);

  const broken = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => fetchCrossref("10.0/x", broken), /returned 500/);

  await assert.rejects(() => fetchCrossref("", async () => ({})), /No DOI/);
});
