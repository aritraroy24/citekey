# Chrome Web Store submission pack

Everything the developer dashboard asks for, ready to paste. Written for whoever files the listing.

## Listing fields

**Name** (75 max)

```
CiteKey: one-click BibTeX with Scholar-matching keys
```

**Short description** (132 max)

```
One-click BibTeX for any journal article, with citation keys that match Google Scholar's so duplicates get flagged.
```

**Category:** Workflow & Planning · **Language:** English

**Detailed description**

```
Generate a complete BibTeX entry for the paper you are reading — one click, without leaving the page.

ONE CLICK, NOT FOUR

Getting a BibTeX entry from Google Scholar means searching for the paper you already have open, clicking Cite, clicking BibTeX, waiting for a second page, and copying from it. You leave the article to fetch a citation for the article.

CiteKey reads the citation metadata that journal pages already embed for indexing services, so the entry is finished before you see it. Click the toolbar button, click Copy. Done, on the page you were already on.

IT WORKS WHEN SCHOLAR WILL NOT

Scholar throttles traffic that looks automated, and a commercial VPN is often enough to trigger it: thousands of people share those exit addresses, so the traffic from one looks like a bot to Scholar and you get a CAPTCHA instead of a BibTeX link. If you keep a VPN running for other work, that is exactly when Scholar stops cooperating. CiteKey never contacts Scholar — it reads the page already open in front of you — so a VPN changes nothing.

KEYS THAT MATCH, SO DUPLICATES GET CAUGHT

Reference managers deduplicate on the entry key. Take a paper from Scholar today, then the same paper from the publisher's site next month with a different tool, and you quietly end up with two entries for one paper and two keys in your manuscript.

CiteKey builds the key the way Scholar does: first author's surname, the year, and the first significant word of the title, lowercased and reduced to plain ASCII — lecun2015deep, van2008visualizing. Import from both sources and the second collides with the first, so your reference manager flags it instead of duplicating it.

WHAT IT HANDLES

• Journal articles, conference papers, book chapters, theses, technical reports and preprints, each given the right entry type automatically
• Web pages as @online, with url and urldate, and organisations as authors written the way BibTeX needs them
• Code repositories, cited by their owner rather than by the page title
• Any page carrying standard citation metadata, which covers most academic publishers and institutional repositories

AND

• Every field editable before you copy, including the citation key
• Two layouts: a compact field order, or a spaced layout for web sources
• A local library of everything you have copied, searchable, exportable as a single .bib file
• Optional Crossref lookup to complete a sparse entry from its DOI — it asks before it ever touches the network
• Light, dark and system themes
• Keyboard shortcut: Alt+B

PRIVACY

No account, no analytics, no server, no tracking. CiteKey reads a page only when you click its button, keeps your entries on your own device, and makes no network request at all unless you explicitly ask for a Crossref lookup.

Free and open source: https://github.com/aritraroy24/citekey
```

### Keep brand names out

A first submission was rejected for keyword spam over a list of publisher names in the detailed description. Describe what the extension reads — "pages carrying standard citation metadata" — rather than listing the publishers, repositories, or reference managers it works with. One or two names where they are functionally necessary (Google Scholar, Crossref) are fine; a roll-call is not.

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
- [x] Screenshot 1280×800 — popup open over a real article page on a publisher site, `@article` selected: `docs/screenshots/popup-on-article.png` (RSC *Digital Discovery*, dark theme), already at store size
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
