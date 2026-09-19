# Vendored third-party code

These files are an unmodified copy of [pdf.js](https://github.com/mozilla/pdf.js) 6.3.289, taken from the
`pdfjs-dist` package and committed here because a Chrome extension cannot load code from a CDN.

- `pdf.min.mjs` — the API, imported by [../pdfread.js](../pdfread.js)
- `pdf.worker.min.mjs` — the worker it runs parsing in

Licensed under Apache-2.0; see [LICENSE](LICENSE). To update, bump `pdfjs-dist` and copy the two
files from `node_modules/pdfjs-dist/build/` over these, then run `npm test`.
