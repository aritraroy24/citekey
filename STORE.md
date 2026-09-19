# Chrome Web Store submission pack

Everything the developer dashboard asks for, ready to paste. Written for whoever files the listing.

## Listing fields

**Name** (75 max)

```
CiteKey — BibTeX with Scholar-matching keys
```

**Short description** (132 max)

```
Generate BibTeX for the article you are reading, with citation keys that match Google Scholar's so duplicate imports get flagged.
```

**Category:** Workflow & Planning · **Language:** English

**Detailed description**

```
CiteKey turns the journal article page you are reading into a finished BibTeX entry, and gives it the same citation key Google Scholar would give it.

That key is the point. Reference managers — Zotero, JabRef, BibDesk, Overleaf — dedupe on the entry key. Import a paper from Scholar, then later grab the same paper from the publisher's site with another tool, and you quietly end up with two entries for one paper. CiteKey generates surname + year + first significant title word, lowercased and ASCII-folded, exactly as Scholar does, so the second import collides with the first and your manager flags it instead of duplicating it.

WHAT IT DOES

• Reads the metadata the publisher already publishes — Highwire citation_* tags (Elsevier, Springer, Wiley, Taylor & Francis, SAGE, IEEE, PubMed Central, arXiv, OJS journals), bepress and EPrints repositories, PRISM, Dublin Core, schema.org JSON-LD, and Open Graph as a last resort.
• Picks the entry type from what the page actually is: @article for journal articles, @inproceedings for conference papers, @online for everything else.
• Writes @online in the layout web sources need, with url and urldate, and @article in Scholar's own compact field order.
• Cites GitHub repositories and GitHub Pages sites by their owner, without the owner/ prefix cluttering the title.
• Warns you when a citation key you just generated was already used for a different source.
• Keeps a local library of what you have copied, searchable, exportable as a single .bib file.
• Completes a sparse entry from Crossref when a DOI is present — optional, and it asks before it ever touches the network.
• Every field is editable before you copy, including the key itself.
• Light, dark and system themes.

PRIVACY

No account, no analytics, no server. The extension reads a page only when you click its button, stores your entries on your own device, and makes no network request unless you explicitly ask for a Crossref lookup.

Open source: https://github.com/aritraroy24/citekey
```

## Permission justifications

Paste each into the matching box in the dashboard.

**activeTab** — Reads the citation metadata of the page the user is on, and only at the moment the user clicks the extension's toolbar button or presses its keyboard shortcut. This is what supplies the title, authors, journal, date and DOI for the BibTeX entry. The extension has no access to any page the user has not activated it on.

**scripting** — Injects the metadata reader (`src/extract.js`) into that same activated tab to collect the `<meta>` tags and structured data. Injection happens on click only; no content script is registered to run automatically on any site.

**storage** — Saves the user's own preferences (entry type, layout, which fields to include) and the entries they have copied, so the extension can warn about duplicate citation keys and export a `.bib` file. All of it stays in the browser; nothing is transmitted.

**`https://api.crossref.org/*`** (optional host permission) — Used only by the "Complete this entry from Crossref" button, to fetch the bibliographic record for a DOI shown on the page when the page's own metadata is incomplete. Requested at the moment the user clicks, never at install, and the extension is fully functional without it.

**Single purpose** — CiteKey generates a BibTeX citation for the scholarly article or web page the user is currently viewing.

## Data-use disclosures

Tick: **no** data collected in every category. Certify all three statements — no sale or transfer to third parties, no use unrelated to the single purpose, no use to determine creditworthiness or for lending.

Privacy policy URL: the raw link to `PRIVACY.md` in the repository, or a page hosting the same text.

## Assets checklist

- [x] Icon 128×128 (`icons/icon128.png`)
- [ ] Screenshot 1280×800 — popup open over a real article page on a publisher site, `@article` selected
- [ ] Screenshot 1280×800 — popup with `@online` selected, showing url + urldate
- [ ] Screenshot 1280×800 — the duplicate-key warning
- [ ] Screenshot 1280×800 — the library page with several entries
- [ ] Optional: small promo tile 440×280

Screenshots must be exactly 1280×800 or 640×400, with no browser chrome mock-ups that imply a partnership with anyone.

`npm run preview` renders both pages at 2x with fixture data into `dist/preview`, in light and dark — a good starting point, though the hero shot is more convincing taken over a real article page with the popup open.

## Before you hit submit

1. `npm test` is green (41 tests, including the manifest guards in `tests/manifest.test.mjs`).
2. Load unpacked once more and check: keyboard shortcut, `@article` on a real publisher page, `@online` on a blog, the Crossref permission prompt, the library export.
3. `npm run package` produces `citekey-<version>.zip` with no `node_modules`, `tests/` or dotfiles inside.
4. Version in `manifest.json` matches the top entry of `CHANGELOG.md`.
