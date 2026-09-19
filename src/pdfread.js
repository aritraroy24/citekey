/* Turns PDF bytes into the plain structure the heuristics in pdfmeta.js work on.

   This is the only file that touches pdf.js. Everything downstream is pure data, which is what
   lets the interesting logic be tested without a PDF engine. Only the first few pages are read:
   a citation lives on page one, and parsing a 60-page monograph to find it would be wasteful. */

/* The import is resolved against this module, but chrome.runtime.getURL() resolves against the
   extension root — hence the two different spellings of the same directory. */
const PDF_JS = "./vendor/pdf.min.mjs";
const PDF_WORKER = "src/vendor/pdf.worker.min.mjs";

/** XMP tags worth pulling; publisher-typeset PDFs carry most of them. */
const XMP_TAGS = [
  "dc:title",
  "dc:creator",
  "dc:publisher",
  "dc:identifier",
  "dc:description",
  "prism:publicationName",
  "prism:volume",
  "prism:number",
  "prism:startingPage",
  "prism:endingPage",
  "prism:doi",
  "prism:issn",
  "prism:coverDate",
  "prism:publicationDate",
  "pdfx:doi",
  "xmp:CreateDate"
];

let pdfjsPromise = null;

/** Load pdf.js once, and point it at the worker shipped beside it. */
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDF_JS).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(PDF_WORKER);
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

function readXmp(metadata) {
  const out = {};
  if (!metadata) return out;
  for (const tag of XMP_TAGS) {
    let value;
    try {
      value = metadata.get(tag);
    } catch (_) {
      continue;
    }
    if (!value) continue;
    out[tag] = Array.isArray(value) ? value.map(clean).filter(Boolean) : clean(value);
  }
  return out;
}

/** Group a page's text items into lines, and each line into cells: runs of text separated by a
    horizontal gap. Author blocks are commonly laid out several across, and without the cells a
    row of four authors reads as one unsplittable string. */
function toLines(items, viewport) {
  const rows = new Map();
  for (const item of items) {
    const text = item.str;
    if (!text || !text.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    // pdf.js reports height in text-space units, which is the font size for ordinary text.
    const size = Math.round((item.height || 0) * 10) / 10;
    const key = Math.round(y);
    if (!rows.has(key)) rows.set(key, { y: key, size, x, parts: [] });
    const row = rows.get(key);
    row.size = Math.max(row.size, size);
    row.x = Math.min(row.x, x);
    row.parts.push({ x, width: item.width || 0, text });
  }

  return [...rows.values()]
    .map((row) => {
      const parts = row.parts.sort((a, b) => a.x - b.x);
      const cells = [];
      let current = null;
      for (const part of parts) {
        const gap = current ? part.x - current.end : 0;
        // A gap wider than about one em is column separation, not word spacing.
        if (!current || gap > Math.max(row.size, 8) * 1.2) {
          current = { text: part.text, end: part.x + part.width };
          cells.push(current);
        } else {
          current.text += (gap > 0.6 ? " " : "") + part.text;
          current.end = Math.max(current.end, part.x + part.width);
        }
      }
      return {
        text: parts.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim(),
        cells: cells.map((cell) => cell.text.replace(/\s+/g, " ").trim()).filter(Boolean),
        size: row.size,
        x: Math.round(row.x),
        y: row.y
      };
    })
    .filter((line) => line.text)
    // Top of the page first: PDF y grows upwards.
    .sort((a, b) => b.y - a.y)
    .map((line) => ({ ...line, fromTop: viewport ? Math.round(viewport.height - line.y) : null }));
}

/**
 * Read a PDF into { info, xmp, pageCount, pages }.
 * `bytes` is an ArrayBuffer or Uint8Array; `maxPages` caps how much is parsed (1-5).
 */
export async function readPdf(bytes, { maxPages = 3 } = {}) {
  const pdfjs = await loadPdfjs();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useWorkerFetch: false,
    // Nothing is rendered, so the extra font and image assets are never needed. Without the
    // lowered verbosity pdf.js complains to the console about the standard fonts it will not
    // need, on every single read.
    disableFontFace: true,
    verbosity: 0
  });
  const doc = await task.promise;

  try {
    const metadata = await doc.getMetadata().catch(() => ({}));
    const limit = Math.max(1, Math.min(maxPages, 5, doc.numPages));
    const pages = [];

    for (let number = 1; number <= limit; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({
        number,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        lines: toLines(content.items, viewport)
      });
      page.cleanup();
    }

    return {
      info: metadata.info || {},
      xmp: readXmp(metadata.metadata),
      pageCount: doc.numPages,
      pages
    };
  } finally {
    // The loading task owns the worker; destroying the proxy alone leaves it running.
    await task.destroy();
  }
}
