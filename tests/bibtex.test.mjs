import test from "node:test";
import assert from "node:assert/strict";
import { citationKey, renderEntry, keyTitlePart, keyAuthorPart, formatAuthors } from "../src/bibtex.js";

const person = (name) => ({ name, corporate: false });
const org = (name) => ({ name, corporate: true });

test("keys reproduce Google Scholar's author+year+word form", () => {
  const cases = [
    [{ authors: [person("LeCun, Yann"), person("Bengio, Yoshua")], title: "Deep learning", year: "2015" }, "lecun2015deep"],
    [{ authors: [person("Hastie, Trevor")], title: "The elements of statistical learning", year: "2009" }, "hastie2009elements"],
    [{ authors: [person("Vaswani, Ashish")], title: "Attention is all you need", year: "2017" }, "vaswani2017attention"],
    // Scholar keys on the first token of the family name, particles included.
    [{ authors: [person("van der Maaten, Laurens")], title: "Visualizing data using t-SNE", year: "2008" }, "van2008visualizing"],
    [{ authors: [org("Google Cloud.")], title: "What Is Artificial Intelligence (AI)?", year: "2023" }, "google2023what"],
    // Accents fold to ASCII, digits survive.
    [{ authors: [person("Müller, Andreas")], title: "3D reconstruction of scenes", year: "2020" }, "muller20203d"]
  ];
  for (const [entry, expected] of cases) {
    assert.equal(citationKey(entry), expected, JSON.stringify(entry.title));
  }
});

test("leading stopwords are skipped, but only leading ones", () => {
  assert.equal(keyTitlePart("On the origin of species"), "origin");
  assert.equal(keyTitlePart("A survey of deep learning"), "survey");
  assert.equal(keyTitlePart("Is Google making us stupid?"), "google");
  assert.equal(keyTitlePart("What is artificial intelligence?"), "what");
  assert.equal(keyTitlePart("The of an"), "the"); // all stopwords: fall back to the first word
});

test("surnames reduce to lowercase ASCII", () => {
  assert.equal(keyAuthorPart([person("O'Neill, Cathy")], "x"), "oneill");
  assert.equal(keyAuthorPart([org("World Health Organization")]), "world");
  assert.equal(keyAuthorPart([]), "");
});

test("@online matches the reference layout", () => {
  const entry = {
    authors: [org("Google Cloud.")],
    title: "What Is Artificial Intelligence (AI)?",
    year: "2023",
    url: "https://cloud.google.com/learn/what-is-artificial-intelligence",
    urldate: "2024-09-25"
  };
  const expected = [
    "@online{google2023what,",
    "  author = {{Google Cloud.}},",
    "  title = {What Is Artificial Intelligence (AI)?},",
    "  year = {2023},",
    "  url = {https://cloud.google.com/learn/what-is-artificial-intelligence},",
    "  urldate = {2024-09-25}",
    "}"
  ].join("\n");
  assert.equal(renderEntry(entry, { type: "online", style: "spaced" }), expected);
});

test("@article follows Scholar's field order and compact spacing", () => {
  const entry = {
    authors: [person("Smith, John A."), person("Doe, Jane")],
    title: "A study of things",
    journal: "Journal of Things",
    volume: "12",
    issue: "3",
    pages: "436--444",
    year: "2021",
    publisher: "Elsevier",
    doi: "10.1000/xyz123"
  };
  const out = renderEntry(entry, { type: "article", includeDoi: false, includeUrl: false });
  assert.equal(
    out,
    [
      "@article{smith2021study,",
      "  title={A study of things},",
      "  author={Smith, John A. and Doe, Jane},",
      "  journal={Journal of Things},",
      "  volume={12},",
      "  number={3},",
      "  pages={436--444},",
      "  year={2021},",
      "  publisher={Elsevier}",
      "}"
    ].join("\n")
  );
});

test("BibTeX specials are escaped and organisations keep their braces", () => {
  assert.equal(formatAuthors([org("Smith & Sons Ltd")]), "{Smith \\& Sons Ltd}");
  const out = renderEntry(
    { authors: [person("Doe, J.")], title: "Cost_of 50% growth #1", year: "2020" },
    { type: "misc" }
  );
  assert.match(out, /title=\{Cost\\_of 50\\% growth \\#1\}/);
});
