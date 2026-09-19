import test from "node:test";
import assert from "node:assert/strict";
import {
  authorsToText,
  textToAuthors,
  isSameSource,
  mergeSettings,
  resolveChoices,
  resolveTheme,
  toBibtexName,
  addToLibrary,
  librarySorted,
  libraryToBib,
  DEFAULT_SETTINGS,
  LIBRARY_LIMIT
} from "../src/entry.js";

test("author text round-trips, braces marking organisations", () => {
  const authors = [
    { name: "Roy, Aritra", corporate: false },
    { name: "Google Cloud.", corporate: true }
  ];
  const text = authorsToText(authors);
  assert.equal(text, "Roy, Aritra\n{Google Cloud.}");
  assert.deepEqual(textToAuthors(text), authors);
});

test("author text ignores blank lines and stray whitespace", () => {
  assert.deepEqual(textToAuthors("  \n Roy, Aritra \n\n{ WHO }\n"), [
    { name: "Roy, Aritra", corporate: false },
    { name: "WHO", corporate: true }
  ]);
  assert.deepEqual(textToAuthors(""), []);
  assert.equal(authorsToText(undefined), "");
});

test("a source matches on either of its URLs", () => {
  const seen = { url: "https://doi.org/10.1/x", pageUrl: "https://journal.example/article/1" };
  assert.equal(isSameSource(seen, { url: "https://journal.example/article/1" }), true);
  assert.equal(isSameSource(seen, { pageUrl: "https://doi.org/10.1/x" }), true);
  assert.equal(isSameSource(seen, { url: "https://elsewhere.example/other" }), false);
  assert.equal(isSameSource(seen, {}), false);
});

test("settings merge keeps defaults for anything unsaved", () => {
  assert.deepEqual(mergeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings({ includeDoi: true, bogus: 1 }), { ...DEFAULT_SETTINGS, includeDoi: true });
  // false and null are real choices, not missing values
  assert.equal(mergeSettings({ keepLibrary: false }).keepLibrary, false);
  assert.equal(mergeSettings({ includeUrl: false }).includeUrl, false);
});

test("auto settings follow the page, pinned settings override it", () => {
  const auto = resolveChoices(DEFAULT_SETTINGS, "online");
  assert.deepEqual(auto, { type: "online", style: "spaced", includeUrl: true, includeDoi: false });

  const autoArticle = resolveChoices(DEFAULT_SETTINGS, "article");
  assert.deepEqual(autoArticle, { type: "article", style: "scholar", includeUrl: false, includeDoi: false });

  const pinned = resolveChoices({ type: "online", style: "scholar", includeUrl: false, includeDoi: true }, "article");
  assert.deepEqual(pinned, { type: "online", style: "scholar", includeUrl: false, includeDoi: true });
});

test("the library keys on the citation key, newest first, and caps its size", () => {
  let library = {};
  library = addToLibrary(library, { key: "a2020x", title: "First", bibtex: "@misc{a2020x}", at: "2026-01-01T00:00:00Z" });
  library = addToLibrary(library, { key: "b2021y", title: "Second", bibtex: "@misc{b2021y}", at: "2026-02-01T00:00:00Z" });
  assert.deepEqual(librarySorted(library).map((r) => r.key), ["b2021y", "a2020x"]);

  // Re-saving a key replaces the record rather than adding a second one.
  library = addToLibrary(library, { key: "a2020x", title: "First, edited", bibtex: "@online{a2020x}", at: "2026-03-01T00:00:00Z" });
  assert.equal(Object.keys(library).length, 2);
  assert.equal(library.a2020x.title, "First, edited");

  let big = {};
  for (let i = 0; i < LIBRARY_LIMIT + 25; i += 1) {
    big = addToLibrary(big, { key: "k" + i, bibtex: "@misc{k" + i + "}", at: new Date(2000, 0, 1 + i).toISOString() });
  }
  assert.equal(Object.keys(big).length, LIBRARY_LIMIT);
  assert.equal(big.k0, undefined, "oldest entries are dropped first");
  assert.ok(big["k" + (LIBRARY_LIMIT + 24)], "newest entry survives");
});

test("export joins entries into one .bib, newest first", () => {
  const library = {
    a2020x: { key: "a2020x", bibtex: "@misc{a2020x}", at: "2026-01-01T00:00:00Z" },
    b2021y: { key: "b2021y", bibtex: "@misc{b2021y}", at: "2026-02-01T00:00:00Z" },
    c2022z: { key: "c2022z", at: "2026-03-01T00:00:00Z" } // never rendered: skipped
  };
  assert.equal(libraryToBib(library), "@misc{b2021y}\n\n@misc{a2020x}\n");
});

test("theme setting defaults to following the system and rejects nonsense", () => {
  assert.equal(DEFAULT_SETTINGS.theme, "system");
  assert.equal(mergeSettings(undefined).theme, "system");
  assert.equal(resolveTheme("dark"), "dark");
  assert.equal(resolveTheme("light"), "light");
  assert.equal(resolveTheme("system"), "system");
  assert.equal(resolveTheme("sepia"), "system");
  assert.equal(resolveTheme(undefined), "system");
  assert.equal(mergeSettings({ theme: "dark" }).theme, "dark");
});

test("shouted names are put back into proper case", () => {
  const name = (raw) => toBibtexName(raw).name;

  // The case that started this: Wiley publishes its author tags in capitals.
  assert.equal(name("TETLOCK, PAUL C."), "Tetlock, Paul C.");
  assert.equal(name("PAUL C. TETLOCK"), "Tetlock, Paul C.");
  // Half-shouted is just as common: the surname in capitals, the given name not.
  assert.equal(name("TETLOCK, Paul C."), "Tetlock, Paul C.");

  assert.equal(name("MCDONALD, JAMES"), "McDonald, James", "Mc keeps its capital");
  assert.equal(name("O'NEILL, CATHY"), "O'Neill, Cathy");
  assert.equal(name("ZHANG, MING-WEI"), "Zhang, Ming-Wei", "both halves of a hyphenated name");
  assert.equal(name("VAN DER MAATEN, LAURENS"), "van der Maaten, Laurens", "particles go back to lower case");
  assert.equal(name("SMITH, JOHN III"), "Smith, John III", "roman numerals are not words");
  assert.equal(name("WU, LI"), "Wu, Li", "short surnames are names, not initials");
});

test("names the author writes mixed are left alone", () => {
  const name = (raw) => toBibtexName(raw).name;
  assert.equal(name("MacDonald, James"), "MacDonald, James");
  assert.equal(name("van der Maaten, Laurens"), "van der Maaten, Laurens");
  assert.equal(name("Vaswani, Ashish"), "Vaswani, Ashish");
  assert.equal(name("Okafor CN"), "Okafor, CN", "trailing initials are not a shouted word");
  assert.equal(name("Smith JA"), "Smith, JA");
});

test("acronyms are organisations, not shouted surnames", () => {
  assert.deepEqual(toBibtexName("IEEE"), { name: "IEEE", corporate: true });
  assert.deepEqual(toBibtexName("NASA"), { name: "NASA", corporate: true });
  assert.deepEqual(toBibtexName("WHO"), { name: "WHO", corporate: true });
  // An organisation keeps whatever capitals it uses.
  assert.equal(toBibtexName("IEEE Computer Society", { corporate: true }).name, "IEEE Computer Society");
});
