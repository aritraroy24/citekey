import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { citationKey, renderEntry, defaultType } from "../src/bibtex.js";

const source = readFileSync(new URL("../src/extract.js", import.meta.url), "utf8");

/** Run the injected extractor against a page, the way chrome.scripting.executeScript does. */
function scrape(html, url) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  // executeScript serialises its result out of the page, so compare the same shape here.
  return JSON.parse(JSON.stringify(dom.window.eval(source)));
}

test("reads Highwire citation_* tags from a publisher page", () => {
  const data = scrape(
    `<html><head>
      <meta name="citation_title" content="Machine learning in clinical practice">
      <meta name="citation_author" content="Patel, Riya S.">
      <meta name="citation_author" content="van der Berg, Johan">
      <meta name="citation_journal_title" content="The Lancet Digital Health">
      <meta name="citation_publisher" content="Elsevier">
      <meta name="citation_volume" content="5">
      <meta name="citation_issue" content="4">
      <meta name="citation_firstpage" content="e201">
      <meta name="citation_lastpage" content="e210">
      <meta name="citation_publication_date" content="2023/04/01">
      <meta name="citation_doi" content="10.1016/S2589-7500(23)00042-1">
      <link rel="canonical" href="https://www.thelancet.com/article/S2589-7500(23)00042-1/fulltext">
    </head><body><h1>Machine learning in clinical practice</h1></body></html>`,
    "https://www.thelancet.com/article/S2589-7500(23)00042-1/fulltext"
  );

  assert.equal(data.title, "Machine learning in clinical practice");
  assert.deepEqual(
    data.authors.map((a) => a.name),
    ["Patel, Riya S.", "van der Berg, Johan"]
  );
  assert.equal(data.journal, "The Lancet Digital Health");
  assert.equal(data.year, "2023");
  assert.equal(data.volume, "5");
  assert.equal(data.issue, "4");
  assert.equal(data.pages, "e201--e210");
  assert.equal(data.doi, "10.1016/S2589-7500(23)00042-1");
  assert.equal(defaultType(data), "article");
  assert.equal(citationKey(data), "patel2023machine");
});

test("turns 'First Last' author tags into 'Last, First'", () => {
  const data = scrape(
    `<html><head>
      <meta name="citation_title" content="A survey of graph neural networks">
      <meta name="citation_author" content="Jie Zhou">
      <meta name="citation_author" content="Laurens van der Maaten">
      <meta name="citation_journal_title" content="AI Open">
      <meta name="citation_date" content="2020-12-01">
    </head><body></body></html>`,
    "https://example.org/a"
  );
  assert.deepEqual(
    data.authors.map((a) => a.name),
    ["Zhou, Jie", "van der Maaten, Laurens"]
  );
  assert.equal(citationKey(data), "zhou2020survey");
});

test("falls back to JSON-LD and Open Graph on a publisher page with no citation tags", () => {
  const data = scrape(
    `<html><head>
      <title>What Is Artificial Intelligence (AI)? | Google Cloud</title>
      <meta property="og:site_name" content="Google Cloud">
      <meta property="og:title" content="What Is Artificial Intelligence (AI)? | Google Cloud">
      <meta property="og:url" content="https://cloud.google.com/learn/what-is-artificial-intelligence">
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"WebPage",
         "headline":"What Is Artificial Intelligence (AI)?",
         "datePublished":"2023-06-12",
         "author":{"@type":"Organization","name":"Google Cloud."}}
      </script>
    </head><body></body></html>`,
    "https://cloud.google.com/learn/what-is-artificial-intelligence"
  );

  assert.equal(data.title, "What Is Artificial Intelligence (AI)?");
  assert.deepEqual(data.authors, [{ name: "Google Cloud.", corporate: true }]);
  assert.equal(data.year, "2023");
  assert.equal(data.hasScholarTags, false);
  assert.equal(defaultType(data), "online");

  data.urldate = "2024-09-25";
  assert.equal(
    renderEntry(data, { type: "online", style: "spaced" }),
    [
      "@online{google2023what,",
      "  author = {{Google Cloud.}},",
      "  title = {What Is Artificial Intelligence (AI)?},",
      "  year = {2023},",
      "  url = {https://cloud.google.com/learn/what-is-artificial-intelligence},",
      "  urldate = {2024-09-25}",
      "}"
    ].join("\n")
  );
});

test("cites a GitHub repository by its owner, without the owner in the title", () => {
  const data = scrape(
    `<html><head>
      <title>GitHub - slimeslab/ComProScanner: A python package for extracting composition-property data</title>
      <meta name="octolytics-dimension-user_login" content="slimeslab">
      <meta property="og:site_name" content="GitHub">
      <meta property="og:title" content="slimeslab/ComProScanner: A python package for extracting composition-property data">
      <meta property="og:url" content="https://github.com/slimeslab/ComProScanner">
    </head><body>
      <relative-time datetime="2025-02-11T09:12:00Z"></relative-time>
      <relative-time datetime="2025-07-30T18:04:00Z"></relative-time>
    </body></html>`,
    "https://github.com/slimeslab/ComProScanner"
  );

  assert.equal(data.title, "ComProScanner: A python package for extracting composition-property data");
  assert.deepEqual(data.authors, [{ name: "slimeslab", corporate: true }]);
  assert.equal(data.year, "2025");
  assert.equal(defaultType(data), "online");

  data.urldate = "2026-09-19";
  assert.equal(
    renderEntry(data, { type: "online", style: "spaced", includeDoi: false }),
    [
      "@online{slimeslab2025comproscanner,",
      "  author = {{slimeslab}},",
      "  title = {ComProScanner: A python package for extracting composition-property data},",
      "  year = {2025},",
      "  url = {https://github.com/slimeslab/ComProScanner},",
      "  urldate = {2026-09-19}",
      "}"
    ].join("\n")
  );
});

test("a GitHub Pages site keys on the subdomain owner", () => {
  const data = scrape(
    `<html><head>
      <title>slimeslab/ComProScanner: documentation</title>
      <meta property="og:title" content="slimeslab/ComProScanner: documentation">
    </head><body></body></html>`,
    "https://slimeslab.github.io/ComProScanner/"
  );
  assert.equal(data.title, "ComProScanner: documentation");
  assert.deepEqual(data.authors, [{ name: "slimeslab", corporate: true }]);
});

test("real citation tags still beat the GitHub owner", () => {
  const data = scrape(
    `<html><head>
      <meta name="citation_title" content="ComProScanner">
      <meta name="citation_author" content="Roy, Aritra">
      <meta name="citation_date" content="2025">
      <meta property="og:title" content="slimeslab/ComProScanner: A python package">
    </head><body></body></html>`,
    "https://github.com/slimeslab/ComProScanner"
  );
  assert.deepEqual(data.authors, [{ name: "Roy, Aritra", corporate: false }]);
  assert.equal(data.title, "ComProScanner");
});

test("detects conference papers and Dublin Core repositories", () => {
  const conf = scrape(
    `<html><head>
      <meta name="citation_title" content="Attention is all you need">
      <meta name="citation_author" content="Vaswani, Ashish">
      <meta name="citation_conference_title" content="Advances in Neural Information Processing Systems">
      <meta name="citation_publication_date" content="2017">
    </head><body></body></html>`,
    "https://papers.nips.cc/paper/7181"
  );
  assert.equal(conf.isConference, true);
  assert.equal(defaultType(conf), "inproceedings");
  assert.equal(citationKey(conf), "vaswani2017attention");

  const repo = scrape(
    `<html><head>
      <meta name="DC.title" content="Open access and the research library">
      <meta name="DC.creator" content="Okoro, Chidi">
      <meta name="DCTERMS.issued" content="2019-05-20">
      <meta name="DC.publisher" content="London South Bank University">
      <meta name="DC.identifier" content="doi:10.18742/rm00123">
    </head><body></body></html>`,
    "https://openresearch.lsbu.ac.uk/item/8xyz1"
  );
  assert.equal(repo.authors[0].name, "Okoro, Chidi");
  assert.equal(repo.year, "2019");
  assert.equal(repo.doi, "10.18742/rm00123");
  assert.equal(citationKey(repo), "okoro2019open");
});

test("handles the shapes real publishers ship", () => {
  // PubMed: authors as "Family Initials", no comma.
  const pubmed = scrape(
    `<html><head>
      <meta name="citation_title" content="Sepsis biomarkers in critical care">
      <meta name="citation_author" content="Okafor CN">
      <meta name="citation_author" content="Lindqvist EM">
      <meta name="citation_journal_title" content="The New England Journal of Medicine">
      <meta name="citation_date" content="2022 Nov 3">
      <meta name="citation_volume" content="387">
      <meta name="citation_firstpage" content="1671">
      <meta name="citation_lastpage" content="1671">
    </head><body></body></html>`,
    "https://pubmed.ncbi.nlm.nih.gov/36322843/"
  );
  assert.equal(pubmed.year, "2022");
  assert.equal(pubmed.pages, "1671", "a single-page article does not become a range");
  assert.equal(citationKey(pubmed), "okafor2022sepsis");

  // arXiv: a preprint with no journal at all.
  const arxiv = scrape(
    `<html><head>
      <meta name="citation_title" content="Language models are few-shot learners">
      <meta name="citation_author" content="Brown, Tom B.">
      <meta name="citation_date" content="2020/05/28">
      <meta name="citation_arxiv_id" content="2005.14165">
    </head><body></body></html>`,
    "https://arxiv.org/abs/2005.14165"
  );
  assert.equal(arxiv.journal, "");
  assert.equal(arxiv.isPreprint, true);
  assert.equal(defaultType(arxiv), "misc");
  assert.equal(citationKey(arxiv), "brown2020language");

  // IEEE-style page: PRISM tags only, plus a DOI printed in the body.
  const ieee = scrape(
    `<html><head>
      <meta name="prism.publicationName" content="IEEE Transactions on Neural Networks">
      <meta name="prism.volume" content="33">
      <meta name="prism.number" content="9">
      <meta name="prism.startingPage" content="4021">
      <meta name="prism.endingPage" content="4035">
      <meta name="prism.publicationDate" content="2022-09-01">
      <meta property="og:title" content="A deep architecture for edge devices">
      <script type="application/ld+json">
        {"@type":"ScholarlyArticle","author":[{"@type":"Person","givenName":"Wei","familyName":"Chen"}]}
      </script>
    </head><body><p>Digital Object Identifier 10.1109/TNNLS.2022.3145678.</p></body></html>`,
    "https://ieeexplore.ieee.org/document/9700001"
  );
  assert.equal(ieee.journal, "IEEE Transactions on Neural Networks");
  assert.equal(ieee.pages, "4021--4035");
  assert.equal(ieee.doi, "10.1109/TNNLS.2022.3145678", "trailing sentence punctuation is trimmed");
  assert.equal(citationKey(ieee), "chen2022deep");
});

test("a page with nothing useful still returns a usable record", () => {
  const data = scrape(`<html><head><title>Untitled</title></head><body></body></html>`, "https://example.org/x");
  assert.equal(data.ok, true);
  assert.deepEqual(data.authors, []);
  assert.equal(data.url, "https://example.org/x");
  assert.equal(citationKey(data), "untitled", "no author and no year still yields a key");
});

test("an arXiv abstract page cites the preprint, like its PDF does", () => {
  const data = scrape(
    `<html><head>
      <meta name="citation_title" content="Language Models are Few-Shot Learners">
      <meta name="citation_author" content="Brown, Tom B.">
      <meta name="citation_date" content="2020/05/28">
      <meta name="citation_arxiv_id" content="2005.14165">
      <meta name="citation_arxiv_primary_category" content="cs.CL">
    </head><body></body></html>`,
    "https://arxiv.org/abs/2005.14165"
  );

  assert.equal(data.eprint, "2005.14165");
  assert.equal(data.primaryClass, "cs.CL");
  assert.equal(defaultType(data), "misc", "a preprint is not an @article or an @online");
  assert.equal(citationKey(data), "brown2020language");
  assert.match(renderEntry(data, { type: "misc", includeUrl: false }), /archivePrefix=\{arXiv\}/);
});

test("the id is read from the url when the page has no arxiv meta tag", () => {
  const data = scrape(
    `<html><head><meta name="citation_title" content="Some preprint about things"></head><body></body></html>`,
    "https://arxiv.org/abs/1706.03762v7"
  );
  assert.equal(data.eprint, "1706.03762");
});
