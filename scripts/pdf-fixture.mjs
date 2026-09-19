/* Capture a real PDF as a test fixture.

   Usage: node scripts/pdf-fixture.mjs <file.pdf> <name> ["source url"]

   Writes tests/fixtures/<name>.json holding the structure src/pdfread.js produces, so the
   heuristics in src/pdfmeta.js can be tested against real publisher output without shipping
   PDFs in the repository or running a PDF engine in the test suite. Development only.

   Keep the fixtures honest: capture what the PDF actually contains, and trim only by dropping
   whole lines from the middle of page two onward, never by editing text. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const XMP_TAGS = [
  "dc:title", "dc:creator", "dc:publisher", "dc:identifier", "dc:description",
  "prism:publicationName", "prism:volume", "prism:number", "prism:startingPage",
  "prism:endingPage", "prism:doi", "prism:issn", "prism:coverDate", "prism:publicationDate",
  "pdfx:doi", "xmp:CreateDate"
];

const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

/* Mirrors toLines() in src/pdfread.js. */
function toLines(items, viewport) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const size = Math.round((item.height || 0) * 10) / 10;
    const key = Math.round(y);
    if (!rows.has(key)) rows.set(key, { y: key, size, x, parts: [] });
    const row = rows.get(key);
    row.size = Math.max(row.size, size);
    row.x = Math.min(row.x, x);
    row.parts.push({ x, width: item.width || 0, text: item.str });
  }

  return [...rows.values()]
    .map((row) => {
      const parts = row.parts.sort((a, b) => a.x - b.x);
      const cells = [];
      let current = null;
      for (const part of parts) {
        const gap = current ? part.x - current.end : 0;
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
        cells: cells.map((c) => c.text.replace(/\s+/g, " ").trim()).filter(Boolean),
        size: row.size,
        x: Math.round(row.x),
        y: row.y
      };
    })
    .filter((line) => line.text)
    .sort((a, b) => b.y - a.y)
    .map((line) => ({ ...line, fromTop: Math.round(viewport.height - line.y) }));
}

const [file, name, url = ""] = process.argv.slice(2);
if (!file || !name) throw new Error("usage: node scripts/pdf-fixture.mjs <file.pdf> <name> [url]");

const doc = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(file)),
  isEvalSupported: false,
  useWorkerFetch: false,
  disableFontFace: true
}).promise;

const metadata = await doc.getMetadata().catch(() => ({}));
const xmp = {};
if (metadata.metadata) {
  for (const tag of XMP_TAGS) {
    const value = metadata.metadata.get(tag);
    if (value) xmp[tag] = Array.isArray(value) ? value.map(clean) : clean(value);
  }
}

const pages = [];
for (let number = 1; number <= Math.min(3, doc.numPages); number += 1) {
  const page = await doc.getPage(number);
  const viewport = page.getViewport({ scale: 1 });
  const lines = toLines((await page.getTextContent()).items, viewport);
  pages.push({
    number,
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
    // Page one carries the title and authors; later pages are only here for the running head,
    // so keep their first and last few lines and drop the body.
    lines: number === 1 ? lines : [...lines.slice(0, 3), ...lines.slice(-3)]
  });
}

const fixture = {
  _source: url || path.basename(file),
  _note: "Captured by scripts/pdf-fixture.mjs from a real PDF; body lines of later pages trimmed.",
  info: metadata.info || {},
  xmp,
  pageCount: doc.numPages,
  pages
};

const out = path.join(root, "tests", "fixtures", name + ".json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n");
console.log("wrote " + path.relative(root, out) + " (" + (fs.statSync(out).size / 1024).toFixed(0) + " KB)");
