# Changelog

All notable changes to CiteKey. This project follows [semantic versioning](https://semver.org/).

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
