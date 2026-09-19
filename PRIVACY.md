# Privacy policy — CiteKey

_Last updated: 19 September 2026_

**CiteKey does not collect, transmit, or sell any data.** There is no account, no analytics, no telemetry, and no server belonging to this extension.

## What the extension reads

When you click the CiteKey toolbar button (or press its keyboard shortcut), it reads the citation metadata of the page in the active tab: title, authors, journal, date, volume, issue, pages, DOI, publisher and URL, taken from the page's own `<meta>` tags and structured data. This happens only on the tab you explicitly activated it on, using Chrome's `activeTab` permission, and only at the moment you click. The extension does not run on pages you have not activated it on, and it reads no other browsing activity.

## PDFs

When the page you are on is a PDF, the extension reads the file itself to find the citation, because a PDF has no metadata tags for it to read. The file is fetched by the tab that is already displaying it and parsed **inside your browser**. Its contents are never uploaded, and nothing about it is stored beyond the citation fields you then choose to copy or save. Opening a PDF from your computer with "Open a file…" works the same way: the file is read in the browser and goes nowhere.

## What is stored, and where

Two things are stored, both by Chrome, on your device:

| Data | Storage | Why |
| --- | --- | --- |
| Your preferences (entry type, layout, field toggles) | `chrome.storage.sync` | So the popup opens the way you last left it. If you have Chrome Sync enabled, Chrome — not this extension — may sync them across your own signed-in devices. |
| Entries you have copied or saved (citation key, title, URL, the BibTeX text, timestamp) | `chrome.storage.local` | To warn you when a citation key you generate has already been used for a different source, and to let the library page export them as one `.bib` file. Never leaves your device. |

You can turn the second one off entirely ("Keep a copy of each entry" in the library page), delete individual entries, or clear the whole library at any time. Removing the extension deletes all of it.

## Network requests

The extension makes **no network requests by default**.

One optional feature makes requests when you ask for it: the lookup buttons send the DOI — or, when there is no DOI, the title and first author — to `https://api.crossref.org` and `https://api.openalex.org` to retrieve the bibliographic record for that work. Chrome asks for your permission the first time, and the feature does nothing until you grant it. Only the DOI and Crossref's requested client identifier are sent — no personal information, no browsing history, no page content. Those services' own privacy policies govern the requests: <https://www.crossref.org/operations-and-sundry/privacy/> and <https://openalex.org/privacy>. You can revoke the permission at any time from `chrome://extensions`.

## Contact

Questions or concerns: open an issue at <https://github.com/aritraroy24/citekey/issues>.
