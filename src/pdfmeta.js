/* Works out what a PDF is from its embedded metadata and the text of its first pages.

   Pure functions over the structure readPdf() returns, so every heuristic here is testable
   without a PDF engine. Three sources, in descending order of trust:

     1. XMP — publisher-typeset PDFs carry dc:title, dc:creator and prism:* and are reliable.
     2. The info dictionary — often present, often junk ("Microsoft Word - draft3.doc"), so sanity
        checked before use.
     3. The page itself — LaTeX PDFs, which includes most preprints and many conference papers,
        carry no usable metadata at all. There the title is the largest text near the top of page
        one, the authors are the lines under it, and the venue is a line of boilerplate somewhere
        in the first two pages.

   Whatever comes out is a starting point the user can correct, and a DOI found along the way is
   worth more than any of it: Crossref settles the record outright. */

import { toBibtexName } from "./entry.js";

const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

/* ---------- shared patterns ---------- */

const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>,;)\]]+/;
const ARXIV_RE = /arXiv:\s*(\d{4}\.\d{4,5})(v\d+)?(?:\s*\[([^\]]+)\])?(?:\s*(\d{1,2}\s+\w+\s+(\d{4})))?/i;
const ISBN_RE = /\bISBN[:\s]*((?:97[89][-\s]?)?[\d][\d\-\s]{7,15}[\dXx])/i;

/** Page furniture that is never part of a title or an author list. */
const NOISE_RE = new RegExp(
  [
    "^\\s*\\d{1,4}\\s*$",
    "downloaded from",
    "this content downloaded",
    "all rights reserved",
    "^\\s*copyright\\b",
    "^\\s*©",
    "creative commons",
    "provided proper attribution",
    "permission to make digital",
    "^https?://",
    "^www\\.",
    "^doi:",
    "^arxiv:",
    "\\bissn\\b",
    "^\\s*preprint\\b",
    "manuscript received",
    "^\\s*page \\d+",
    "^\\s*\\d+\\s*of\\s*\\d+\\s*$"
  ].join("|"),
  "i"
);

/* Affiliation rows sit directly beneath the author row and are shaped exactly like names —
   "Google Brain" parses as a person unless the lab and company words are named here. */
const AFFILIATION_RE =
  /\b(universit\w*|college|school|institut\w*|laborator\w*|labs?|department|dept|faculty|academy|hospital|clinic|centre|center|inc|ltd|llc|gmbh|corporation|research|foundation|ministry|agency|brain|google|microsoft|deepmind|openai|nvidia|amazon|meta|facebook|ibm|intel|adobe|baidu|alibaba|tencent|huawei|samsung|cnrs|inria)\b/i;

const SECTION_RE = /^\s*(abstract|a\s*b\s*s\s*t\s*r\s*a\s*c\s*t|introduction|keywords|key\s*words|index terms|1\.?\s+introduction|summary)\b/i;

/* ---------- title ---------- */

/** Reject info-dictionary titles that are really file names or authoring-tool leftovers. */
export function looksLikeRealTitle(value) {
  const text = clean(value);
  if (text.length < 8 || text.length > 300) return false;
  if (!/[a-z]/i.test(text)) return false;
  if (/\.(docx?|pdf|tex|indd|qxd|rtf|odt)\b/i.test(text)) return false;
  if (/^(microsoft word|untitled|document\d*|paper\d*|manuscript|print|layout|output|template)\b/i.test(text)) return false;
  if (/^[\d\s\-_.]+$/.test(text)) return false;
  return true;
}

/**
 * The title of a typeset paper is the largest run of text near the top of page one.
 * Returns the joined lines, or "" when nothing convincing is there.
 */
export function titleFromLines(page) {
  if (!page || !page.lines || !page.lines.length) return "";
  const height = page.height || 792;

  const candidates = page.lines.filter(
    (line) =>
      line.fromTop != null &&
      line.fromTop < height * 0.7 &&
      line.text.length > 3 &&
      !NOISE_RE.test(line.text) &&
      !SECTION_RE.test(line.text) &&
      !line.text.includes("@")
  );
  if (!candidates.length) return "";

  const biggest = Math.max(...candidates.map((line) => line.size));
  // Body text and title are rarely the same size; if they are, this is not a heading layout.
  const bodySize = median(page.lines.map((line) => line.size));
  if (biggest <= bodySize + 0.5) return "";

  const start = candidates.findIndex((line) => line.size >= biggest - 0.4);
  const block = [candidates[start]];

  // Keep following lines while they stay at title size and stay close by: a two-line title is
  // common, a title separated from the next big line by half a page is not.
  for (let i = start + 1; i < candidates.length; i += 1) {
    const line = candidates[i];
    const previous = block[block.length - 1];
    if (line.size < biggest - 0.4) break;
    if (previous.y - line.y > line.size * 2.5) break;
    block.push(line);
  }

  const title = clean(block.map((line) => line.text).join(" "));
  return looksLikeRealTitle(title) ? title : "";
}

function median(values) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length / 2)];
}

/* ---------- authors ---------- */

const NAME_TOKEN = /^[A-ZÀ-Þ][\p{L}'’.-]*$/u;

/** Does this look like a person's name rather than an affiliation or a sentence? */
export function looksLikePersonName(value) {
  const text = clean(value).replace(/[*†‡§¶#0-9]/g, "").replace(/\s+/g, " ").trim();
  if (text.length < 4 || text.length > 60) return false;
  if (text.includes("@") || /\d/.test(text)) return false;
  if (AFFILIATION_RE.test(text)) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return false;
  return tokens.filter((token) => NAME_TOKEN.test(token)).length >= 2;
}

/** Split an author line into individual names. */
export function splitAuthorLine(line) {
  return clean(line)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .split(/\s*(?:,|;|\band\b|&|·|\|)\s*/i)
    .map((part) => clean(part).replace(/[*†‡§¶#]+/g, "").replace(/\s*\d+\s*$/, "").trim())
    .filter(Boolean);
}

/** Author lines sit between the title and the abstract, above any affiliation block. */
export function authorsFromLines(page, title) {
  if (!page || !page.lines) return [];
  const lines = page.lines;

  let start = 0;
  if (title) {
    const lastTitleWord = clean(title).split(" ").slice(-1)[0];
    const at = lines.findIndex((line) => line.text.includes(lastTitleWord));
    if (at >= 0) start = at + 1;
  }

  const names = [];
  for (const line of lines.slice(start, start + 14)) {
    if (SECTION_RE.test(line.text)) break;
    if (line.text.length > 200) break;
    if (NOISE_RE.test(line.text) || line.text.includes("@") || AFFILIATION_RE.test(line.text)) continue;

    const segments = line.cells && line.cells.length > 1 ? line.cells : [line.text];
    const parts = segments.flatMap((segment) => splitAuthorLine(segment)).filter(looksLikePersonName);
    if (!parts.length) continue;
    names.push(...parts);
    if (names.length >= 30) break;
  }

  const seen = new Set();
  return names
    .map((name) => toBibtexName(name))
    .filter((author) => author && !author.corporate)
    .filter((author) => {
      const key = author.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/* ---------- venue, type, and the rest ---------- */

const VENUE_RULES = [
  {
    // "Proceedings of the 31st International Conference on Neural Information Processing Systems"
    type: "inproceedings",
    re: /(?:in\s+)?proceedings\s+of\s+(?:the\s+)?([^.;]{6,110}?)(?=\s*[,.;(]|\s+pages\b|$)/i,
    field: "booktitle",
    prefix: "Proceedings of the "
  },
  {
    // ACM-style banner: "KDD '17, August 13-17, 2017, Halifax, NS, Canada"
    type: "inproceedings",
    re: /\b([A-Z][A-Za-z]{1,12}\s*['’]\d{2})\s*,\s*[A-Z][a-z]+\s+\d{1,2}\s*[–-]\s*\d{1,2}\s*,\s*(\d{4})/,
    field: "booktitle"
  },
  {
    type: "inproceedings",
    re: /\b(\d{4}\s+[A-Z][^.;]{6,90}?(?:Conference|Symposium|Workshop|Congress)[^.;]{0,40}?)(?=\s*[,.;(]|$)/,
    field: "booktitle"
  },
  {
    // "Conference on Neural Information Processing Systems (NIPS 2017)" — the ordinal that
    // usually precedes it is often typeset as its own cell and lost from the line.
    type: "inproceedings",
    re: /\b((?:\d{1,3}(?:st|nd|rd|th)\s+)?(?:Annual\s+)?(?:International\s+)?(?:Conference|Symposium|Workshop)\s+on\s+[^.;()]{3,70}?)\s*\(\s*(?:[A-Za-z-]+\s*)?(\d{4})\s*\)/,
    field: "booktitle"
  },
  {
    // "31st Conference on Neural Information Processing Systems (NIPS 2017)"
    type: "inproceedings",
    re: /\b(\d{1,3}(?:st|nd|rd|th)\s+[^.;()]{2,100}?(?:Conference|Symposium|Workshop|Meeting)(?:\s+on\s+[^.;()]{3,70})?)\s*\(?\s*(?:[A-Za-z-]+\s*)?(\d{4})?\s*\)?/,
    field: "booktitle"
  },
  {
    type: "incollection",
    re: /\b(Lecture Notes in (?:Computer Science|Artificial Intelligence|Bioinformatics))\b/i,
    field: "series"
  }
];

/** Everything the first pages say about where this was published. */
export function venueFromText(text) {
  const found = { type: "", booktitle: "", series: "", journal: "", volume: "", issue: "", pages: "", year: "", publisher: "" };

  for (const rule of VENUE_RULES) {
    const hit = text.match(rule.re);
    if (!hit) continue;
    const value = clean(hit[1]);
    if (!value) continue;
    if (rule.field === "booktitle" && !found.booktitle) {
      found.booktitle = rule.prefix ? rule.prefix + value : value;
      found.type = found.type || rule.type;
      if (hit[2] && /^\d{4}$/.test(hit[2])) found.year = found.year || hit[2];
    } else if (rule.field === "series" && !found.series) {
      found.series = value;
      found.type = found.type || rule.type;
    }
  }

  const journal = text.match(/\b((?:[A-Z][\w&.'’-]*\s+){0,4}Journal(?:\s+of\s+(?:[A-Z][\w&.'’-]*\s*){1,5})?)/);
  if (journal) found.journal = clean(journal[1]);

  const volume = text.match(/\bVol(?:ume)?\.?\s*(\d{1,4})\b/i);
  if (volume) found.volume = volume[1];

  const issue = text.match(/\b(?:No|Number|Issue)\.?\s*(\d{1,4})\b/i);
  if (issue) found.issue = issue[1];

  const pages = text.match(/\bpp?\.\s*(\d{1,5})\s*[–—-]\s*(\d{1,5})\b/);
  if (pages) found.pages = pages[1] + "--" + pages[2];

  const isbn = text.match(ISBN_RE);
  if (isbn && !found.booktitle && !found.journal) found.type = found.type || "book";

  const copyright = text.match(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[–-]\s*)?(\d{4})/i);
  if (copyright) found.year = found.year || copyright[1];

  if (!found.year && found.booktitle) {
    const inVenue = found.booktitle.match(/\b(19\d{2}|20\d{2})\b/);
    if (inVenue) found.year = inVenue[1];
  }

  if (!found.type && (found.journal || (found.volume && found.pages))) found.type = "article";
  return found;
}

/**
 * Journals print their name in the running head or footer of every page. That repetition is the
 * signal: a line that appears at the top or bottom of two or more pages, once the page number,
 * date and DOI are stripped off, is the publication's name.
 */
export function runningHeadJournal(pages) {
  if (!pages || pages.length < 2) return "";
  const counts = new Map();

  for (const page of pages) {
    const lines = page.lines || [];
    if (!lines.length) continue;
    // Count each candidate once per page: on a short page the first and last line are the same
    // line, and counting it twice would let a single page look like a repetition.
    const seenOnPage = new Set();
    for (const line of [lines[0], lines[lines.length - 1]]) {
      if (!line) continue;
      const candidate = clean(
        line.text
          .split(/[|·]/)[0]
          .replace(DOI_RE, " ")
          .replace(/https?:\/\/\S+/g, " ")
          .replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g, " ")
          .replace(/\b(19|20)\d{2}\b/g, " ")
          .replace(/\b\d+\b/g, " ")
      ).replace(/[,;:]\s*$/, "");

      if (candidate.length < 3 || candidate.length > 60) continue;
      if (!/[A-Za-z]/.test(candidate) || !/[A-Z]/.test(candidate)) continue;
      if (candidate.split(/\s+/).length > 8) continue;
      if (seenOnPage.has(candidate)) continue;
      seenOnPage.add(candidate);
      counts.set(candidate, (counts.get(candidate) || 0) + 1);
    }
  }

  const best = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : "";
}

/** The arXiv stamp down the left margin of a preprint. */
export function arxivFromText(text) {
  const hit = text.match(ARXIV_RE);
  if (!hit) return null;
  const eprint = hit[1];
  // 1706.03762 -> first posted 2017-06. The stamp date belongs to the newest revision, so a
  // paper revised years later would otherwise be dated to the revision.
  const posted = eprint.match(/^(\d{2})(\d{2})\./);
  const year = posted ? (Number(posted[1]) > 90 ? "19" : "20") + posted[1] : hit[5] || "";
  return { eprint, primaryClass: hit[3] ? clean(hit[3]) : "", year, stampYear: hit[5] || "" };
}

function yearFrom(...values) {
  for (const value of values) {
    const hit = clean(value).match(/(19\d{2}|20\d{2}|21\d{2})/);
    if (hit) return hit[1];
  }
  return "";
}

/** PDF date strings look like D:20240410211143Z. */
function yearFromPdfDate(value) {
  const hit = clean(value).match(/D:(\d{4})/);
  return hit ? hit[1] : "";
}

/**
 * Split an author-list string from metadata into names.
 * Shapes seen in the wild: "A Smith; B Jones", "A Smith, B Jones, C Wu", "Smith, Alice" (one
 * author, already inverted) and "A Smith and B Jones".
 */
export function splitAuthorList(value) {
  const text = clean(value);
  if (!text) return [];

  if (text.includes(";")) return text.split(";").map(clean).filter(Boolean);

  const andParts = text.split(/\s+and\s+|\s*&\s*/i).map(clean).filter(Boolean);
  const commas = (text.match(/,/g) || []).length;

  if (andParts.length > 1) return andParts.flatMap((part) => (part.includes(",") ? splitAuthorList(part) : [part]));

  // One comma and two short halves is "Last, First", not two people.
  if (commas === 1) {
    const [left, right] = text.split(",").map(clean);
    if (left.split(" ").length <= 3 && right.split(" ").length <= 3) return [text];
  }
  if (commas >= 1) return text.split(",").map(clean).filter(Boolean);
  return [text];
}

function namesFromMetadata(value) {
  if (!value) return [];
  const list = (Array.isArray(value) ? value : [value]).flatMap((entry) => splitAuthorList(entry));
  return list
    .map(clean)
    .filter((name) => name && !/^\d+$/.test(name))
    .map((name) => toBibtexName(name))
    .filter(Boolean);
}

/**
 * Fold a parsed PDF into the record shape the rest of the extension uses.
 * `source` marks where each field came from, which drives what the popup tells the user.
 */
export function pdfToEntry(doc, { url = "" } = {}) {
  const pages = (doc && doc.pages) || [];
  const first = pages[0] || null;
  const text = pages.map((page) => page.lines.map((line) => line.text).join(" ")).join("\n");
  const xmp = (doc && doc.xmp) || {};
  const info = (doc && doc.info) || {};
  const source = {};

  /* title */
  let title = "";
  if (looksLikeRealTitle(xmp["dc:title"])) {
    title = clean(xmp["dc:title"]);
    source.title = "xmp";
  } else if (looksLikeRealTitle(info.Title)) {
    title = clean(info.Title);
    source.title = "info";
  } else {
    title = titleFromLines(first);
    if (title) source.title = "layout";
  }

  /* authors */
  let authors = namesFromMetadata(xmp["dc:creator"]);
  if (authors.length) source.authors = "xmp";
  if (!authors.length && clean(info.Author)) {
    authors = namesFromMetadata(info.Author);
    if (authors.length) source.authors = "info";
  }
  if (!authors.length) {
    authors = authorsFromLines(first, title);
    if (authors.length) source.authors = "layout";
  }

  /* identifiers */
  const doi = clean(
    xmp["prism:doi"] ||
      xmp["pdfx:doi"] ||
      (String(xmp["dc:identifier"] || "").match(DOI_RE) || [""])[0] ||
      (text.match(DOI_RE) || [""])[0]
  ).replace(/[.,;]+$/, "");
  if (doi) source.doi = xmp["prism:doi"] || xmp["pdfx:doi"] ? "xmp" : "text";

  const arxiv = arxivFromText(text);
  const venue = venueFromText(text);

  // A running head names the journal on pages the venue boilerplate never mentions.
  if (!venue.booktitle && !venue.journal) {
    const head = runningHeadJournal(pages);
    if (head && head.toLowerCase() !== clean(title).toLowerCase().slice(0, head.length)) {
      venue.journal = head;
      venue.type = venue.type || "article";
    }
  }

  /* type */
  let type = "";
  if (arxiv) {
    /* An arXiv PDF is a preprint and is cited as one, even when its own footnote names the
       conference the work later appeared at. Citing the copy you actually read is the honest
       thing to do, and it is what arXiv's own BibTeX export gives you. */
    type = "misc";
  } else if (xmp["prism:publicationName"]) {
    type = "article";
  } else if (venue.type) {
    type = venue.type;
  }

  const year = yearFrom(
    arxiv && arxiv.year,
    xmp["prism:coverDate"],
    xmp["prism:publicationDate"],
    venue.year,
    xmp["xmp:CreateDate"],
    yearFromPdfDate(info.CreationDate)
  );
  if (year) {
    source.year = arxiv && arxiv.year ? "arxiv" : xmp["prism:coverDate"] || xmp["prism:publicationDate"] ? "xmp" : venue.year ? "text" : "filedate";
  }

  const journal = clean(xmp["prism:publicationName"]) || (type === "article" ? venue.journal : "");

  /* A preprint carries none of the published version's numbering: no journal, no volume, no page
     range. Everything that identifies it is the eprint id. */
  const entry = arxiv
    ? {
        title,
        authors,
        journal: "",
        year,
        volume: "",
        issue: "",
        pages: "",
        publisher: "",
        doi,
        url: "https://arxiv.org/abs/" + arxiv.eprint,
        pageUrl: url,
        isConference: false,
        isPreprint: true,
        eprint: arxiv.eprint,
        primaryClass: arxiv.primaryClass,
        suggestedType: "misc",
        source: { ...source, venue: "arxiv" },
        confidence: confidenceOf({ title, authors, doi, source, type })
      }
    : {
        title,
        authors,
        journal: type === "inproceedings" || type === "incollection" ? venue.booktitle || venue.series || journal : journal,
        year,
        volume: clean(xmp["prism:volume"]) || venue.volume,
        issue: clean(xmp["prism:number"]) || venue.issue,
        pages:
          xmp["prism:startingPage"] && xmp["prism:endingPage"]
            ? clean(xmp["prism:startingPage"]) + "--" + clean(xmp["prism:endingPage"])
            : venue.pages,
        publisher: clean(xmp["dc:publisher"]) || venue.publisher,
        doi,
        url,
        pageUrl: url,
        isConference: type === "inproceedings",
        isPreprint: false,
        eprint: "",
        primaryClass: "",
        suggestedType: type || (journal ? "article" : "misc"),
        source,
        confidence: confidenceOf({ title, authors, doi, source, type })
      };

  return entry;
}

/** How much the popup should encourage the user to check the result. */
export function confidenceOf({ title, authors, doi, source, type }) {
  if (doi) return "high";
  if (source.title === "xmp" && authors.length) return "high";
  if (title && authors.length && type) return "medium";
  if (title && authors.length) return "medium";
  return "low";
}
