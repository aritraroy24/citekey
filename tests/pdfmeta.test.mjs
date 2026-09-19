/* The PDF heuristics, run against structures captured from real PDFs by
   scripts/pdf-fixture.mjs. Between them the fixtures cover the three shapes that matter:
   a LaTeX preprint with no metadata at all, a publisher PDF with full XMP, and conference
   proceedings from two different typesetters. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  pdfToEntry,
  titleFromLines,
  looksLikeRealTitle,
  looksLikePersonName,
  splitAuthorList,
  runningHeadJournal,
  arxivFromText,
  venueFromText
} from "../src/pdfmeta.js";
import { citationKey } from "../src/bibtex.js";

const fixture = (name) => JSON.parse(readFileSync(new URL("./fixtures/" + name + ".json", import.meta.url), "utf8"));

test("a LaTeX preprint with no metadata is read from its layout", () => {
  const entry = pdfToEntry(fixture("arxiv-preprint"), { url: "https://arxiv.org/pdf/1706.03762" });

  assert.equal(entry.title, "Attention Is All You Need");
  assert.equal(entry.source.title, "layout", "the info dictionary is empty in this PDF");
  assert.deepEqual(
    entry.authors.slice(0, 4).map((a) => a.name),
    ["Vaswani, Ashish", "Shazeer, Noam", "Parmar, Niki", "Uszkoreit, Jakob"]
  );
  // The affiliation row sits directly under the authors and is shaped just like names.
  assert.ok(
    !entry.authors.some((a) => /google|brain|research|toronto/i.test(a.name)),
    "affiliations must not be read as authors: " + JSON.stringify(entry.authors.map((a) => a.name))
  );
  // 1706.xxxxx was first posted in June 2017; the stamp on this copy says 2023, being a revision.
  assert.equal(entry.year, "2017");
  assert.equal(entry.isPreprint, true);
  assert.equal(entry.eprint, "1706.03762");
  assert.equal(citationKey(entry), "vaswani2017attention");
});

test("a publisher PDF is read from its XMP", () => {
  const entry = pdfToEntry(fixture("plos-journal"));

  assert.equal(entry.source.title, "xmp");
  assert.equal(entry.source.authors, "xmp");
  assert.equal(entry.doi, "10.1371/journal.pone.0287577");
  assert.equal(entry.confidence, "high");
  assert.equal(entry.journal, "PLOS ONE", "the journal comes from the running head");
  assert.equal(entry.suggestedType, "article");
  // dc:creator arrives as one string holding every author.
  assert.equal(entry.authors.length, 10);
  assert.equal(entry.authors[0].name, "Choi, Ji Myung");
  assert.equal(citationKey(entry), "choi2023computer");
});

test("conference proceedings are recognised as such, from two typesetters", () => {
  const neurips = pdfToEntry(fixture("neurips-proceedings"));
  assert.equal(neurips.suggestedType, "inproceedings");
  assert.equal(neurips.isConference, true);
  assert.match(neurips.journal, /Neural Information Processing Systems/);
  assert.equal(neurips.year, "2017", "the year is inside the venue's parentheses");
  assert.equal(citationKey(neurips), "vaswani2017attention");

  const acl = pdfToEntry(fixture("acl-proceedings"));
  assert.equal(acl.suggestedType, "inproceedings");
  assert.match(acl.journal, /^Proceedings of the/);
  assert.equal(citationKey(acl), "devlin2019bert");
});

test("the same paper keys identically whichever copy you have", () => {
  // The preprint and the proceedings version must not produce two library entries.
  assert.equal(
    citationKey(pdfToEntry(fixture("arxiv-preprint"))),
    citationKey(pdfToEntry(fixture("neurips-proceedings")))
  );
});

test("info-dictionary titles are sanity checked", () => {
  assert.equal(looksLikeRealTitle("Attention Is All You Need"), true);
  assert.equal(looksLikeRealTitle("Microsoft Word - paper_final3.doc"), false);
  assert.equal(looksLikeRealTitle("untitled"), false);
  assert.equal(looksLikeRealTitle("draft.tex"), false);
  assert.equal(looksLikeRealTitle("   "), false);
  assert.equal(looksLikeRealTitle("12345678"), false);
});

test("a page with no heading larger than its body text yields no title", () => {
  const flat = { height: 792, lines: [
    { text: "Some running text that goes on", size: 10, y: 700, fromTop: 92, cells: [] },
    { text: "and continues at the same size", size: 10, y: 686, fromTop: 106, cells: [] }
  ] };
  assert.equal(titleFromLines(flat), "");
});

test("names are told apart from affiliations", () => {
  assert.equal(looksLikePersonName("Ashish Vaswani"), true);
  assert.equal(looksLikePersonName("Aidan N. Gomez"), true);
  assert.equal(looksLikePersonName("Google Brain"), false);
  assert.equal(looksLikePersonName("University of Toronto"), false);
  assert.equal(looksLikePersonName("avaswani@google.com"), false);
  assert.equal(looksLikePersonName("Abstract"), false);
  assert.equal(looksLikePersonName("We propose a new simple network architecture"), false);
});

test("author-list strings split on the shapes metadata actually uses", () => {
  assert.deepEqual(splitAuthorList("A Smith; B Jones"), ["A Smith", "B Jones"]);
  assert.deepEqual(splitAuthorList("Ada Smith, Bo Jones, Cy Wu"), ["Ada Smith", "Bo Jones", "Cy Wu"]);
  assert.deepEqual(splitAuthorList("Ada Smith and Bo Jones"), ["Ada Smith", "Bo Jones"]);
  // One comma between two short halves is an inverted single name, not two people.
  assert.deepEqual(splitAuthorList("Smith, Ada"), ["Smith, Ada"]);
  assert.deepEqual(splitAuthorList(""), []);
});

test("the arXiv id dates the paper, not the stamp on the copy", () => {
  const revised = arxivFromText("arXiv:1706.03762v7 [cs.CL] 2 Aug 2023");
  assert.equal(revised.eprint, "1706.03762");
  assert.equal(revised.year, "2017");
  assert.equal(revised.stampYear, "2023");
  assert.equal(revised.primaryClass, "cs.CL");
  assert.equal(arxivFromText("no stamp here"), null);
});

test("venue boilerplate yields a type and a name", () => {
  const proceedings = venueFromText("In Proceedings of the 2019 Conference on Empirical Methods, pages 1-10.");
  assert.equal(proceedings.type, "inproceedings");
  assert.match(proceedings.booktitle, /^Proceedings of the/);

  const journal = venueFromText("International Journal of Testing, Vol. 12, No. 3, pp. 45-67, 2011.");
  assert.equal(journal.volume, "12");
  assert.equal(journal.issue, "3");
  assert.equal(journal.pages, "45--67");
  assert.equal(journal.type, "article");
});

test("a running head is only believed when it repeats across pages", () => {
  const repeated = [
    { lines: [{ text: "PLOS ONE | https://doi.org/10.1371/journal.pone.1 June 2023 1 / 18" }] },
    { lines: [{ text: "PLOS ONE | https://doi.org/10.1371/journal.pone.1 June 2023 2 / 18" }] }
  ];
  assert.equal(runningHeadJournal(repeated), "PLOS ONE");

  const once = [{ lines: [{ text: "PLOS ONE | something" }] }, { lines: [{ text: "Unrelated line" }] }];
  assert.equal(runningHeadJournal(once), "");
  assert.equal(runningHeadJournal([]), "");
});

test("PDF urls are recognised without fetching anything", async () => {
  const { looksLikePdfUrl } = await import("../src/pdfsource.js");
  assert.equal(looksLikePdfUrl("https://arxiv.org/pdf/1706.03762"), true);
  assert.equal(looksLikePdfUrl("https://example.org/paper.pdf?download=1"), true);
  assert.equal(looksLikePdfUrl("https://onlinelibrary.wiley.com/doi/pdf/10.1002/x"), true);
  assert.equal(looksLikePdfUrl("https://www.nature.com/articles/s41586-021-1"), false);
  assert.equal(looksLikePdfUrl(""), false);
});

test("an arXiv PDF is cited as the preprint it is, not as the paper it became", async () => {
  const { renderEntry } = await import("../src/bibtex.js");
  const entry = pdfToEntry(fixture("arxiv-preprint"), { url: "https://arxiv.org/pdf/1706.03762" });

  // This PDF's own footnote names the NeurIPS conference; the preprint is what was read.
  assert.equal(entry.suggestedType, "misc");
  assert.equal(entry.isConference, false);
  assert.equal(entry.journal, "", "a preprint has no venue");
  assert.equal(entry.volume, "");
  assert.equal(entry.pages, "");
  assert.equal(entry.eprint, "1706.03762");
  assert.equal(entry.primaryClass, "cs.CL");
  assert.equal(entry.url, "https://arxiv.org/abs/1706.03762");

  assert.equal(
    renderEntry(entry, { type: "misc", includeUrl: true, includeDoi: false }),
    [
      "@misc{vaswani2017attention,",
      "  title={Attention Is All You Need},",
      "  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Polosukhin, Illia},",
      "  year={2017},",
      "  eprint={1706.03762},",
      "  archivePrefix={arXiv},",
      "  primaryClass={cs.CL},",
      "  url={https://arxiv.org/abs/1706.03762}",
      "}"
    ].join("\n")
  );
});

test("an eprint id makes an entry a preprint whatever else the page claimed", async () => {
  const { defaultType, renderEntry } = await import("../src/bibtex.js");
  assert.equal(defaultType({ eprint: "2005.14165", journal: "Some Journal" }), "misc");
  assert.equal(defaultType({ isConference: true, eprint: "2005.14165" }), "misc");
  assert.equal(defaultType({ journal: "Nature" }), "article");

  // \url{} is dropped in favour of the eprint fields, but kept for a plain @misc.
  const preprint = renderEntry({ title: "A paper", authors: [{ name: "Doe, J." }], year: "2020", eprint: "2005.14165", url: "https://arxiv.org/abs/2005.14165" }, { type: "misc" });
  assert.doesNotMatch(preprint, /howpublished/);
  const webpage = renderEntry({ title: "A page", authors: [{ name: "Doe, J." }], year: "2020", url: "https://example.org/x" }, { type: "misc" });
  assert.ok(
    webpage.includes("howpublished={\\url{https://example.org/x}}"),
    "a plain @misc still points at its url: " + webpage
  );
});
