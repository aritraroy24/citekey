# CiteKey

A Chrome (MV3) extension that generates a BibTeX entry for whatever article page you are on, using **the same citation key Google Scholar would produce**. Import the same paper from both Scholar and this extension and your reference manager flags the duplicate instead of silently storing it twice.

It also renders `@online` entries in the layout used for web sources:

```bibtex
@online{google2023what,
  author = {{Google Cloud.}},
  title = {What Is Artificial Intelligence (AI)?},
  year = {2023},
  url = {https://cloud.google.com/learn/what-is-artificial-intelligence},
  urldate = {2024-09-25}
}
```

No account, no analytics, no server. See [PRIVACY.md](PRIVACY.md).

If CiteKey saves you some typing, **star the repo** — and if it misreads a page, [open an issue](https://github.com/aritraroy24/citekey/issues) with the URL. Publisher markup is the whole ball game here, and every page you report becomes a test fixture.

## Install

**From source:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

Works the same in Edge, Brave and any other Chromium browser. `npm run package` builds the Web Store upload zip in `dist/`.

## Use

Open an article page and click the toolbar button, or press **Alt+B** (rebindable at `chrome://extensions/shortcuts`). The popup reads the page's metadata, shows the finished entry, and offers **Copy BibTeX** or **Save .bib**.

- **Entry type** — `@article` when the page declares a journal, `@inproceedings` for conference papers, `@online` otherwise. Override it at any time; `doi` is off by default and `url` + `urldate` follow the entry type.
- **Layout** — *Scholar (compact)* writes `title={…}` in Scholar's own field order, so a diff against a Scholar export is near-empty. *Spaced* writes `author = {…}`, matching the `@online` example above.
- **Your choices stick.** Entry type, layout and both toggles are remembered across sessions, so a "always `@online`, always spaced" workflow is set once. Defaults live on the library page.
- **Edit fields** — opens every field for correction, including the citation key. The key recomputes as you edit the author, title, or year, until you type in the key box yourself. Fields open automatically when a page has no proper citation metadata.
- **Complete from Crossref** — appears when the entry has a DOI. Fetches the authoritative record (authors, journal, volume, issue, pages, year) and merges it in, which is what rescues PDF viewers and older journal pages. Chrome asks for permission the first time; the extension is fully usable without it.
- **Duplicate warning** — every key you copy or save is remembered locally. If that key later comes up for a *different* page, a warning names the earlier page and date. Copying the same page again — after switching entry type or layout, say — says nothing.
- **Library** — the button in the footer opens a page listing everything you have copied, searchable, with per-entry copy/delete and **Export all as .bib**.

## How the citation key is built

`firstAuthorSurname` + `year` + `firstSignificantTitleWord`, lowercased and reduced to ASCII alphanumerics — for example `lecun2015deep`, `van2008visualizing`, `google2023what`.

- The surname contributes only its **first whitespace token**, which is why "Laurens van der Maaten" keys as `van…`, exactly as Scholar does it.
- Accents fold to ASCII (`Müller` → `muller`), digits survive (`3D` → `3d`), everything else is dropped.
- The title word is the first word that is not one of: *a, an, the, on, of, in, into, for, from, to, with, at, by, as, and, or, nor, is, are, was, were, be, been, being, over, under, about*. Only leading ones are skipped — "Attention is all you need" keys as `attention`, "Is Google making us stupid?" as `google`.
- A corporate author keys on its first word, so `{Google Cloud.}` gives `google`.

If the page has no year, the key is author + title word and **will not match Scholar's** — the popup warns when this happens.

## Where the metadata comes from

Read in order of reliability, first hit wins per field:

1. **Highwire Press** `citation_*` tags — Elsevier, Springer, Wiley, Taylor & Francis, SAGE, IEEE, PubMed Central, arXiv, most OJS journals.
2. **bepress** `bepress_citation_*` and `eprints.*` — institutional repositories.
3. **PRISM** `prism.*` and **Dublin Core** `dc.*` / `dcterms.*`.
4. **schema.org JSON-LD** (`ScholarlyArticle`, `Article`, `NewsArticle`, `WebPage`, …).
5. **Open Graph** / `<h1>` / `<title>`, plus a DOI sniffed out of the page text.

**GitHub** — on `github.com` repositories and `*.github.io` pages the owner is the author (`author = {{slimeslab}}`) and the `owner/` prefix is dropped from the title, so `slimeslab/ComProScanner: A python package…` becomes `ComProScanner: A python package…`. The year comes from the newest date GitHub renders on the page. A page carrying proper `citation_*` tags overrides all of this.

Author names are normalised to `Last, First`, with name particles (van, von, de, del, …) kept with the surname and PubMed-style trailing initials (`Okafor CN`) understood as such. Names that look like organisations get the double braces BibTeX needs (`{{Google Cloud.}}`) so they are never reordered or abbreviated.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the metadata of the page you clicked the button on — and only then. |
| `scripting` | Inject the metadata reader into that tab. No content script runs automatically anywhere. |
| `storage` | Remember your preferences and the entries you copied, on your device. |
| `https://api.crossref.org/*` | **Optional.** Requested the first time you use the Crossref lookup; never at install. |

## Development

```bash
npm install   # jsdom, used only by the tests
npm test      # 35 tests
npm run package
```

The suite pins the key algorithm against known Scholar keys, pins both output layouts byte for byte, runs the real extractor against jsdom fixtures for Highwire, JSON-LD-only, GitHub, PubMed, arXiv, IEEE/PRISM, Dublin Core and empty pages, and guards the things a Web Store review would bounce (missing files, over-long listing text, unjustified permissions). `node_modules` is not part of the extension — only `manifest.json`, `src/`, `icons/` and `_locales/` are packaged.

| File | Role |
| --- | --- |
| [manifest.json](manifest.json) | MV3 manifest |
| [src/extract.js](src/extract.js) | injected into the page; returns one metadata record |
| [src/bibtex.js](src/bibtex.js) | key generation, escaping, entry rendering |
| [src/entry.js](src/entry.js) | shared pure helpers: authors, settings, library |
| [src/crossref.js](src/crossref.js) | DOI lookup and record merging |
| [src/popup.*](src/popup.js) | the popup |
| [src/library.*](src/library.js) | saved entries and preferences |
| [scripts/package.mjs](scripts/package.mjs) | builds the Web Store zip |
| [STORE.md](STORE.md) | listing copy, permission justifications, submission checklist |

## Feedback

Issues and pull requests are welcome at <https://github.com/aritraroy24/citekey>. The most useful report is simply a URL the extension got wrong, together with what the entry should have said — that pins down a fixture and a fix in one go. And a star helps other people writing bibliographies find it.

## Licence

MIT — see [LICENSE](LICENSE).
