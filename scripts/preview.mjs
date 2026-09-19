/* Render the extension's pages in a real browser and save PNGs to dist/preview.

   Development only — nothing here ships. It drives the Chrome already installed on the machine
   through puppeteer-core, serving the project over http (ES modules will not load over file://)
   and stubbing the chrome.* APIs with fixture data, so the pages run exactly as they do in the
   browser without needing the extension installed.

   Run with `npm run preview`. Useful for checking a design change in both themes, and for
   staging the Chrome Web Store screenshots. */

import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = path.join(root, "dist", "preview");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error("No Chrome found. Set CHROME_PATH to its executable.");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

/* ---------- fixture: a typical journal article page ---------- */

const ARTICLE = {
  ok: true,
  title: "Machine learning for materials discovery: a decade in review",
  authors: [
    { name: "Patel, Riya S.", corporate: false },
    { name: "van der Berg, Johan", corporate: false },
    { name: "Okafor, Chidi N.", corporate: false }
  ],
  journal: "Patterns",
  publisher: "Elsevier",
  year: "2021",
  volume: "2",
  issue: "6",
  pages: "100232--100244",
  doi: "10.1016/j.patter.2021.100232",
  url: "https://www.sciencedirect.com/science/article/pii/S2666389921000969",
  pageUrl: "https://www.sciencedirect.com/science/article/pii/S2666389921000969",
  hasScholarTags: true,
  isConference: false,
  isPreprint: false,
  siteName: "ScienceDirect"
};

const LIBRARY = {
  patel2021machine: {
    key: "patel2021machine",
    title: ARTICLE.title,
    url: ARTICLE.url,
    type: "article",
    at: "2026-09-18T09:14:00Z",
    bibtex: "@article{patel2021machine,\n  title={Machine learning for materials discovery: a decade in review},\n  author={Patel, Riya S. and van der Berg, Johan and Okafor, Chidi N.},\n  journal={Patterns},\n  volume={2},\n  number={6},\n  pages={100232--100244},\n  year={2021},\n  publisher={Elsevier}\n}"
  },
  google2023what: {
    key: "google2023what",
    title: "What Is Artificial Intelligence (AI)?",
    url: "https://cloud.google.com/learn/what-is-artificial-intelligence",
    type: "online",
    at: "2026-09-17T16:02:00Z",
    bibtex: "@online{google2023what,\n  author = {{Google Cloud.}},\n  title = {What Is Artificial Intelligence (AI)?},\n  year = {2023},\n  url = {https://cloud.google.com/learn/what-is-artificial-intelligence},\n  urldate = {2026-09-17}\n}"
  },
  vaswani2017attention: {
    key: "vaswani2017attention",
    title: "Attention is all you need",
    url: "https://papers.nips.cc/paper/7181",
    type: "inproceedings",
    at: "2026-09-15T11:41:00Z",
    bibtex: "@inproceedings{vaswani2017attention,\n  title={Attention is all you need},\n  author={Vaswani, Ashish and Shazeer, Noam},\n  booktitle={Advances in Neural Information Processing Systems},\n  year={2017}\n}"
  }
};

/** The chrome.* surface the pages touch, backed by plain objects. */
function stubSource(settings, library) {
  return `
    const settings = ${JSON.stringify(settings)};
    const library = ${JSON.stringify(library)};
    const area = (store) => ({
      get: async (key) => (key in store ? { [key]: store[key] } : {}),
      set: async (patch) => Object.assign(store, patch)
    });
    window.chrome = {
      storage: { sync: area({ settings }), local: area({ library }) },
      tabs: { query: async () => [{ id: 1, url: ${JSON.stringify(ARTICLE.pageUrl)} }] },
      scripting: { executeScript: async () => [{ result: ${JSON.stringify(ARTICLE)} }] },
      permissions: { request: async () => true },
      runtime: { openOptionsPage() {} }
    };
  `;
}

/* ---------- run ---------- */

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !existsSync(file)) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  response.end(await readFile(file));
});

await new Promise((resolve) => server.listen(0, resolve));
const origin = "http://localhost:" + server.address().port;
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath, headless: "new", args: ["--force-device-scale-factor=2"] });

async function shoot(name, { page: pagePath, theme, width, height, settings = {}, library = {}, after }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme === "dark" ? "dark" : "light" }]);
  await page.evaluateOnNewDocument(stubSource({ theme: "system", ...settings }, library));
  await page.goto(origin + pagePath, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 250));
  if (after) await after(page);
  const file = path.join(outDir, name + ".png");
  await page.screenshot({ path: file, fullPage: true });
  console.log("  " + path.relative(root, file));
  await page.close();
}

console.log("Rendering with " + executablePath);

await shoot("popup-light", { page: "/src/popup.html", theme: "light", width: 440, height: 620 });
await shoot("popup-dark", { page: "/src/popup.html", theme: "dark", width: 440, height: 620 });
await shoot("popup-fields", {
  page: "/src/popup.html",
  theme: "light",
  width: 440,
  height: 900,
  after: async (page) => {
    await page.click("#toggleFields");
    await new Promise((r) => setTimeout(r, 200));
  }
});
await shoot("popup-online", {
  page: "/src/popup.html",
  theme: "dark",
  width: 440,
  height: 620,
  settings: { type: "online", style: "spaced", includeUrl: true }
});
await shoot("library-light", { page: "/src/library.html", theme: "light", width: 900, height: 900, library: LIBRARY });
await shoot("library-dark", { page: "/src/library.html", theme: "dark", width: 900, height: 900, library: LIBRARY });

await browser.close();
server.close();
console.log("Done.");
