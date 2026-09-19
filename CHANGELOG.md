# Changelog

All notable changes to CiteKey. This project follows [semantic versioning](https://semver.org/).

## [1.1.0] - 2026-09-19

### Added

- Looks papers up in Crossref and OpenAlex rather than trusting a PDF's layout: a DOI is used directly, and without one both databases are searched by title, the best candidate scored against the title, authors and year the document gave, and any DOI it names followed for the complete record. OpenAlex covers the older workshop papers and preprints Crossref never registered.
- Shows what a found record contradicts before applying it, and never replaces your fields without a click.
- Puts shouted author names back into proper case: a publisher writing "TETLOCK, PAUL C." now yields "Tetlock, Paul C.". Initials, roman numerals, acronyms and deliberately mixed names are left as they are.
- Reads IEEE Xplore, which publishes no citation tags at all and previously yielded a title and nothing else. The record it keeps in the page is used instead, giving authors, venue, volume, issue, pages, DOI and the right entry type. Only the bibliographic fields are read: that same object also holds the reader's institution and entitlements.

- Reads PDFs. When the tab is a PDF there is no page metadata to scrape, so CiteKey parses the file itself: the embedded XMP and info dictionary where publishers provide them, and otherwise the layout of the first pages - the largest text near the top is the title, the lines beneath it are the authors, and the venue comes from the boilerplate a publisher prints on page one.
- Works out the entry type from the PDF: conference proceedings, journal article, preprint or book.
- Cites arXiv papers as preprints, in the shape arXiv's own export uses: `@misc` with `eprint`, `archivePrefix` and `primaryClass`, and no journal, volume or pages, even where the PDF's footnote names a conference. Abstract pages on arxiv.org are treated the same way.
- Dates arXiv preprints from the identifier rather than the stamp, so a paper revised years later is still dated to its first posting.
- Names the journal from the running head, which is the one place a journal prints its name on every page.
- "Find this paper on Crossref" searches by title and author for PDFs with no DOI, and shows what it found for confirmation before applying it. A DOI lookup still applies directly, being identity rather than a guess.
- Reads the file through the tab itself, so PDFs behind a bot check or a login work, with a file picker as the fallback that always works.

## [1.0.1] — 2026-09-19

### Changed

- Name and summary now lead with the benefit: "CiteKey: one-click BibTeX with Scholar-matching keys", and "One-click BibTeX for any journal article…".

## [1.0.0] — 2026-09-19

First public release.

### Added

- BibTeX generation for the active tab, with citation keys matching Google Scholar's format (surname + year + first significant title word, ASCII-folded).
- Metadata extraction from Highwire `citation_*` tags, bepress and EPrints, PRISM, Dublin Core, schema.org JSON-LD and Open Graph, with a DOI sniffed from page text as a fallback.
- Entry types `@article`, `@online`, `@inproceedings`, `@incollection`, `@book`, `@techreport`, `@phdthesis` and `@misc`, chosen automatically from what the page declares.
- Two layouts: Scholar's compact field order, and the spaced layout used for `@online` sources.
- GitHub support: repositories and GitHub Pages sites are cited by their owner, with the `owner/` prefix removed from the title.
- Duplicate warning when a citation key was previously used for a different source.
- Local library of copied entries, searchable, with export to a single `.bib` file.
- Optional Crossref lookup to complete sparse entries from a DOI, behind a permission requested at the moment of use.
- Preferences persisted across sessions, keyboard shortcut (Alt+B by default), and an editable form for every field including the key.
- Light, dark and system themes, defaulting to the system setting and applied before first paint so the popup never flashes the wrong palette.
- A design system shared by both pages: tokens for colour, spacing and type, switches, segmented controls, and status banners that state their tone with an icon as well as a colour.
- The popup sizes itself to its content up to Chrome's 600px cap, with the output box grown to the entry. Past the cap only the middle section scrolls, so the entry-type controls and the Copy button never move out of reach.
- `npm run preview` renders both pages in a real browser with fixture data and reports the popup's height, for checking a design change in both themes and for staging store screenshots.
