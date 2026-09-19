/* Guards for the token system. A colour defined in only one of the three theme states is
   invisible in review but breaks for whichever users land in the state that misses it. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

const themeCss = read("src/theme.css");

/** The body of the rule whose selector line starts at `from`, brace-matched. */
function blockAfter(css, marker) {
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, "missing block: " + marker);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
    }
  }
  throw new Error("unbalanced braces after " + marker);
}

const definitions = (block) => new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

const lightBlock = blockAfter(themeCss, "\n:root {");
const systemDarkBlock = blockAfter(themeCss, ':root:not([data-theme="light"])');
const pinnedDarkBlock = blockAfter(themeCss, ':root[data-theme="dark"]');

test("both dark states define exactly the same tokens", () => {
  const system = [...definitions(systemDarkBlock)].sort();
  const pinned = [...definitions(pinnedDarkBlock)].sort();
  assert.deepEqual(
    pinned,
    system,
    "the explicit dark theme and the system dark theme must stay in step"
  );
  assert.ok(system.length > 10, "expected a full dark palette");
});

test("every dark token has a light counterpart on bare :root", () => {
  const light = definitions(lightBlock);
  for (const token of definitions(systemDarkBlock)) {
    assert.ok(light.has(token), token + " is only defined in dark; light would fall back to nothing");
  }
});

test("every var() used by any stylesheet is defined", () => {
  const defined = definitions(themeCss);
  for (const file of ["src/theme.css", "src/popup.css", "src/library.css"]) {
    const css = read(file);
    for (const [, token] of css.matchAll(/var\((--[\w-]+)/g)) {
      assert.ok(defined.has(token), token + " is used in " + file + " but never defined");
    }
  }
});

test("both pages apply the theme before they paint", () => {
  for (const page of ["src/popup.html", "src/library.html"]) {
    const html = read(page);
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(head, /<script src="theme\.js"><\/script>/, page + " must load theme.js in <head>");
    assert.ok(
      head.indexOf('src="theme.js"') < head.indexOf('href="theme.css"'),
      page + " must set the theme before the stylesheet is applied"
    );
    // A deferred module would let the page paint in the wrong theme first.
    assert.doesNotMatch(head, /<script[^>]+theme\.js[^>]+(type="module"|defer)/, page + ": theme.js must stay a blocking classic script");
    assert.match(html, /data-theme-choice="light"[\s\S]*data-theme-choice="dark"[\s\S]*data-theme-choice="system"/, page + " needs all three theme buttons");
  }
});

test("the popup stays inside the size Chrome allows a popup", () => {
  const css = read("src/popup.css");
  const body = css.match(/body\s*{[^}]*}/);
  assert.ok(body, "popup.css must style the body");

  const width = body[0].match(/width:\s*(\d+)px/);
  assert.ok(width && Number(width[1]) <= 780, "a popup wider than ~780px gets clipped by Chrome");

  const maxHeight = body[0].match(/max-height:\s*(\d+)px/);
  assert.ok(maxHeight, "the body must cap its height, or Chrome scrolls the whole document");
  assert.ok(Number(maxHeight[1]) <= 600, "Chrome caps a popup at 600px");
});

test("only the middle of the popup can scroll, so the controls and footer stay reachable", () => {
  const html = read("src/popup.html");
  const css = read("src/popup.css");

  // The header, the controls card and the footer sit outside the scrolling region.
  const scrollStart = html.indexOf('<div class="scroll">');
  assert.notEqual(scrollStart, -1, "popup.html needs a .scroll region");
  const scrollEnd = html.indexOf("<footer");
  for (const id of ["status", "dupe", "crossrefRow", "fields", "output"]) {
    const at = html.indexOf('id="' + id + '"');
    assert.ok(at > scrollStart && at < scrollEnd, "#" + id + " belongs inside the scrolling region");
  }
  for (const marker of ["<header", 'class="controls']) {
    assert.ok(html.indexOf(marker) < scrollStart, marker + " must sit above the scrolling region");
  }
  assert.ok(scrollEnd > html.indexOf('id="output"'), "the footer must sit below the scrolling region");

  assert.match(css, /\.scroll\s*{[^}]*overflow-y:\s*auto/, ".scroll must be the scrolling element");
  assert.match(css, /\.scroll\s*{[^}]*min-height:\s*0/, "a flex child needs min-height:0 before it will scroll");
});
