/* Injected into the active tab by the popup. chrome.scripting.executeScript hands back the value
   of the last expression in the file, so the whole extractor is one IIFE that returns a record. */
(() => {
  const text = (s) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim());

  const metas = (name) => {
    const lower = name.toLowerCase();
    const out = [];
    for (const el of document.querySelectorAll("meta")) {
      const key = (el.getAttribute("name") || el.getAttribute("property") || "").toLowerCase();
      if (key === lower) {
        const v = text(el.getAttribute("content"));
        if (v) out.push(v);
      }
    }
    return out;
  };

  const meta = (...names) => {
    for (const n of names) {
      const v = metas(n);
      if (v.length) return v[0];
    }
    return "";
  };

  const metaAll = (...names) => {
    for (const n of names) {
      const v = metas(n);
      if (v.length) return v;
    }
    return [];
  };

  const yearFrom = (...values) => {
    for (const v of values) {
      const m = text(v).match(/(1[5-9]\d{2}|20\d{2}|21\d{2})/);
      if (m) return m[1];
    }
    return "";
  };

  /* ---------- GitHub ---------- */

  /* Repository and GitHub Pages sites put "owner/repo: description" in the title and name no author.
     The owner is the thing to cite as author, and it does not belong in the title as well. */
  const github = (() => {
    const host = location.hostname.toLowerCase();
    const onRepo = host === "github.com" || host === "www.github.com";
    const onPages = host.endsWith(".github.io");
    if (!onRepo && !onPages) return null;

    const segments = location.pathname.split("/").filter(Boolean);
    const owner = text(
      meta("octolytics-dimension-user_login", "octolytics-dimension-repository_network_root_owner") ||
        (onPages ? host.split(".")[0] : segments[0] || "")
    );
    if (!owner) return null;
    return { owner, repo: onPages ? segments[0] || "" : segments[1] || "" };
  })();

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const stripGithubOwner = (value) => {
    if (!github) return value;
    return text(
      value
        .replace(/^GitHub\s*[-–—:]\s*/i, "")
        .replace(new RegExp("^" + escapeRe(github.owner) + "\\s*/\\s*", "i"), "")
    );
  };

  /** Newest date GitHub shows on the page — the release or last commit, i.e. the version being cited. */
  const githubDate = () => {
    const stamps = Array.from(document.querySelectorAll("relative-time[datetime], time-ago[datetime], time[datetime]"))
      .map((el) => el.getAttribute("datetime"))
      .filter(Boolean)
      .sort();
    return stamps.length ? stamps[stamps.length - 1] : "";
  };

  /* ---------- IEEE Xplore ---------- */

  /* IEEE Xplore publishes no citation_* tags at all — only og:title — but the whole record sits
     in a script as xplGlobal.document.metadata. Only the bibliographic fields are read from it:
     the same object also carries the reader's institution and subscription entitlements, which
     are none of this extension's business. */
  const ieee = (() => {
    if (!/(^|\.)ieee\.org$/i.test(location.hostname)) return null;

    for (const script of document.querySelectorAll("script")) {
      const source = script.textContent || "";
      const at = source.indexOf("xplGlobal.document.metadata");
      if (at === -1) continue;

      const open = source.indexOf("{", at);
      if (open === -1) continue;

      // Brace-match rather than regex: the object contains nested objects and escaped strings.
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = open; i < source.length; i += 1) {
        const ch = source[i];
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = !inString;
        } else if (!inString && ch === "{") {
          depth += 1;
        } else if (!inString && ch === "}") {
          depth -= 1;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(source.slice(open, i + 1));
              return parsed && parsed.title ? parsed : null;
            } catch (_) {
              return null;
            }
          }
        }
      }
    }
    return null;
  })();

  const ieeeAuthors = () => {
    if (!ieee || !Array.isArray(ieee.authors)) return [];
    return ieee.authors
      .map((a) => {
        if (a.lastName && a.firstName) return { name: text(a.lastName) + ", " + text(a.firstName), organisation: false };
        return { name: text(a.name), organisation: undefined };
      })
      .filter((a) => a.name);
  };

  const ieeePages = () => {
    if (!ieee) return "";
    const first = text(ieee.startPage);
    const last = text(ieee.endPage);
    if (first && last && first !== last) return first + "--" + last;
    return first || "";
  };

  const ieeeIssn = () => {
    if (!ieee || !Array.isArray(ieee.issn)) return "";
    const electronic = ieee.issn.find((i) => /electronic/i.test(i.format || ""));
    return text((electronic || ieee.issn[0] || {}).value);
  };

  /* ---------- schema.org JSON-LD ---------- */

  const jsonLdNodes = () => {
    const nodes = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      nodes.push(node);
      if (node["@graph"]) walk(node["@graph"]);
      for (const k of ["mainEntity", "mainEntityOfPage", "isPartOf", "hasPart"]) {
        if (node[k] && typeof node[k] === "object") walk(node[k]);
      }
    };
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walk(JSON.parse(el.textContent));
      } catch (_) {
        /* publishers ship broken JSON-LD often enough that a silent skip is the right call */
      }
    }
    return nodes;
  };

  const typeOf = (node) => [].concat(node["@type"] || []).map((t) => String(t).toLowerCase());

  const ARTICLE_TYPES = [
    "scholarlyarticle", "article", "newsarticle", "blogposting", "report",
    "techarticle", "webpage", "creativework", "book", "chapter"
  ];

  const ldNodes = jsonLdNodes();
  const ld = ldNodes.find((n) => typeOf(n).some((t) => ARTICLE_TYPES.includes(t))) || {};

  const ldName = (v) => {
    if (!v) return "";
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return ldName(v[0]);
    return text(v.name || v.legalName || "");
  };

  const ldAuthors = (v) => {
    if (!v) return [];
    const list = Array.isArray(v) ? v : [v];
    return list
      .map((a) => {
        if (typeof a === "string") return { name: text(a), organisation: undefined };
        const org = typeOf(a).includes("organization") ? true : undefined;
        if (a.familyName) {
          const given = text(a.givenName);
          const family = text(a.familyName);
          return { name: given ? family + ", " + given : family, organisation: org };
        }
        return { name: ldName(a), organisation: org };
      })
      .filter((a) => a.name);
  };

  /* ---------- authors ---------- */

  const ORG_HINTS = /\b(inc|ltd|llc|plc|gmbh|corp|corporation|company|cloud|group|team|universit\w*|college|school|institute|institut|laborator\w*|foundation|association|society|council|commission|committee|ministry|department|agency|authority|bureau|office|organi[sz]ation|centre|center|network|consortium|press|publishing|publishers|editors|staff|news|bank|fund|programme|unicef|unesco|who|oecd|nhs|nasa|ieee|acm|iso)\b/i;

  const looksCorporate = (name) => {
    if (!name) return false;
    if (name.includes(",")) return false;
    if (ORG_HINTS.test(name)) return true;
    return name.split(/\s+/).length > 4;
  };

  const PARTICLES = ["van", "von", "de", "del", "della", "der", "den", "di", "da", "dos", "du", "la", "le", "bin", "ibn", "al", "ter", "ten", "st"];

  /* Several publishers shout their author names — "TETLOCK, PAUL C." — which then travels into
     every entry. Only runs of capitals are lowered, so initials, roman numerals and names the
     author writes mixed ("MacDonald", "van der Maaten") survive untouched. Mirrors fixNameCaps()
     in entry.js; this file is injected on its own and cannot import it. */
  const ROMAN = /^(?:I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XI?V|XX)$/;

  const fixNameCaps = (value) =>
    String(value || "").replace(/[^\s,]+/g, (token) => {
      if (ROMAN.test(token)) return token;
      if (!/[A-Z]{2,}/.test(token)) return token;

      const titled = token.replace(/[A-Z]{2,}/g, (run) => run[0] + run.slice(1).toLowerCase());
      const bare = titled.toLowerCase().replace(/\./g, "");
      if (PARTICLES.includes(bare)) return titled.toLowerCase();
      return titled.replace(/^Mc([a-z])/, (_, letter) => "Mc" + letter.toUpperCase());
    });

  const normaliseAuthor = (raw, organisation) => {
    const name = text(raw).replace(/^(by|By)\s+/, "").replace(/[;|,]\s*$/, "").trim();
    if (!name || /^https?:/i.test(name)) return null;

    const corporate = organisation === true || (organisation !== false && looksCorporate(name));
    // An organisation's capitals are its own: "IEEE" and "NASA" are not shouting.
    if (corporate) return { name, corporate: true };

    /* All capitals means every run is shouted; in a mixed name only the longer runs are, so
       "Okafor CN" keeps its initials. */
    const shouted = !/[a-z]/.test(name);
    const fix = (part) => (shouted ? fixNameCaps(part) : part.replace(/\b[A-Z]{3,}\b/g, (run) => fixNameCaps(run)));

    if (name.includes(",")) {
      // Already "Last, First M." — the order BibTeX wants.
      const [last, ...rest] = name.split(",");
      const given = text(rest.join(" "));
      return { name: given ? fix(text(last)) + ", " + fix(given) : fix(text(last)), corporate: false };
    }

    const parts = name.split(/\s+/);
    if (parts.length === 1) return { name: fix(parts[0]), corporate: false };

    // PubMed and several indexes write "Okafor CN" — trailing initials, surname first already.
    const trailingInitials = /^(?:[A-Z]{1,3}|(?:[A-Z]\.){1,3})$/.test(parts[parts.length - 1]);
    if (trailingInitials) {
      const surname = parts.slice(0, -1).join(" ");
      return { name: fix(surname) + ", " + parts[parts.length - 1], corporate: false };
    }

    // "First M. Last" -> "Last, First M."
    let cut = parts.length - 1;
    while (cut > 1 && PARTICLES.includes(parts[cut - 1].toLowerCase().replace(/\./g, ""))) cut -= 1;
    const last = parts.slice(cut).join(" ");
    const given = parts.slice(0, cut).join(" ");
    return { name: fix(last) + ", " + fix(given), corporate: false };
  };

  const collectAuthors = () => {
    /* A GitHub page names its owner, not an author. Real citation tags (a CITATION.cff rendered by
       the site, say) still win — they carry the human names the owner asked to be cited by. */
    if (github && !metas("citation_author").length && !metas("bepress_citation_author").length) {
      return [{ name: github.owner, corporate: true }];
    }

    let raw = [];
    if (ieee) {
      const fromIeee = ieeeAuthors();
      if (fromIeee.length) raw = fromIeee;
    }

    if (!raw.length) raw = metaAll(
      "citation_author", "bepress_citation_author", "eprints.creators_name",
      "dc.creator", "dcterms.creator", "dc.contributor", "author", "article:author", "parsely-author"
    ).map((n) => ({ name: n, organisation: undefined }));

    if (!raw.length) {
      const joined = meta("citation_authors", "bepress_citation_authors", "authors");
      if (joined) raw = joined.split(/\s*;\s*|\s+and\s+/i).map((n) => ({ name: n, organisation: undefined }));
    }

    if (!raw.length) raw = ldAuthors(ld.author || ld.creator);

    if (!raw.length) {
      const nodes = document.querySelectorAll(
        '[itemprop="author"], .author-name, .loa__author-name, .c-article-author-list__item a, a[rel="author"]'
      );
      raw = Array.from(nodes).slice(0, 30).map((n) => ({ name: text(n.textContent), organisation: undefined }));
    }

    const seen = new Set();
    const out = [];
    for (const r of raw) {
      const a = normaliseAuthor(r.name, r.organisation);
      if (!a) continue;
      const key = a.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return out;
  };

  /* ---------- individual fields ---------- */

  const siteName = text(meta("og:site_name"));

  const stripSiteSuffix = (t) => {
    if (!siteName) return t;
    const m = t.match(/^(.*?)\s*[|·–—-]\s*([^|·–—-]{2,60})$/);
    if (m && m[2].toLowerCase().includes(siteName.toLowerCase().slice(0, 12))) return text(m[1]);
    return t;
  };

  const rawTitle = text(
    meta("citation_title", "bepress_citation_title", "dc.title", "dcterms.title", "eprints.title") ||
      (ieee ? ieee.title : "") ||
      ldName(ld.headline || ld.name) ||
      meta("og:title", "twitter:title") ||
      text(document.querySelector("h1") && document.querySelector("h1").textContent) ||
      document.title
  );
  const title = stripGithubOwner(stripSiteSuffix(rawTitle));

  const journal = text(
    meta(
      "citation_journal_title", "bepress_citation_journal_title", "citation_conference_title",
      "citation_inbook_title", "prism.publicationName", "dc.source", "dcterms.source"
    ) ||
      (ieee ? ieee.publicationTitle || ieee.displayPublicationTitle : "") ||
      ldName(ld.isPartOf && (ld.isPartOf.isPartOf || ld.isPartOf))
  );

  const publisher = text(
    meta("citation_publisher", "bepress_citation_publisher", "dc.publisher", "dcterms.publisher", "prism.corporateEntity") ||
      (ieee ? ieee.publisher : "") ||
      ldName(ld.publisher) ||
      siteName
  );

  /** First 20k of visible text — enough to catch a DOI printed on the page, cheap enough to scan. */
  const bodyText = () => {
    const body = document.body;
    if (!body) return "";
    return String(body.innerText || body.textContent || "").slice(0, 20000);
  };

  const doiRaw = text(
    meta("citation_doi", "bepress_citation_doi", "prism.doi", "dc.identifier.doi", "doi") ||
      (String(meta("dc.identifier", "dcterms.identifier")).match(/10\.\d{4,9}\/\S+/) || [""])[0] ||
      (ieee ? ieee.doi : "") ||
      ((bodyText().match(/\b10\.\d{4,9}\/[^\s"'<>]+/)) || [""])[0]
  );
  const doi = doiRaw.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, "").replace(/[.,;)\]]+$/, "");

  const firstPage = meta("citation_firstpage", "bepress_citation_firstpage", "prism.startingPage");
  const lastPage = meta("citation_lastpage", "bepress_citation_lastpage", "prism.endingPage");
  let pages = firstPage && lastPage && firstPage !== lastPage ? firstPage + "--" + lastPage : firstPage || "";
  if (!pages) {
    const rawPages = meta("citation_pages", "prism.pageRange");
    if (rawPages) pages = rawPages.replace(/\s*[-–—]+\s*/, "--");
  }

  /* arXiv abstract pages carry the id in a meta tag; other preprint servers put it in the URL.
     Either way the entry should cite the preprint, not the version that appeared later. */
  const arxivId = text(
    meta("citation_arxiv_id", "arxiv:id") ||
      (location.hostname.includes("arxiv.org")
        ? (location.pathname.match(/(\d{4}\.\d{4,5})(v\d+)?/) || ["", ""])[1]
        : "")
  );

  const canonical = document.querySelector('link[rel="canonical"]');
  const url = text(
    meta("citation_abstract_html_url", "bepress_citation_abstract_html_url") ||
      (canonical && canonical.href) ||
      meta("og:url") ||
      location.href
  );

  const year = yearFrom(
    meta(
      "citation_publication_date", "citation_date", "citation_year", "citation_cover_date",
      "bepress_citation_date", "prism.publicationDate", "prism.coverDate",
      "dc.date", "dcterms.issued", "dc.date.issued", "eprints.date"
    ),
    ieee ? ieee.publicationYear || ieee.publicationDate : "",
    ld.datePublished,
    meta("article:published_time", "og:article:published_time", "date"),
    ld.dateCreated,
    meta("citation_online_date"),
    text(document.querySelector("time[datetime]") && document.querySelector("time[datetime]").getAttribute("datetime")),
    // GitHub dates everything in <relative-time>: the newest release or commit shown on the page.
    github ? githubDate() : ""
  );

  /* Chrome renders a PDF inside an internal viewer, so the document carries an <embed> and no
     readable text. The popup switches to reading the file itself when it sees this. */
  const isPdf =
    document.contentType === "application/pdf" ||
    Boolean(document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]'));

  return {
    ok: true,
    isPdf,
    eprint: arxivId,
    primaryClass: text(meta("citation_arxiv_primary_category")),
    title,
    authors: collectAuthors(),
    journal,
    publisher,
    year,
    volume: text(meta("citation_volume", "bepress_citation_volume", "prism.volume") || (ieee ? ieee.volume : "")),
    issue: text(meta("citation_issue", "bepress_citation_issue", "prism.number") || (ieee ? ieee.issue : "")),
    pages: pages || ieeePages(),
    doi,
    issn: text(meta("citation_issn", "prism.issn", "prism.eIssn") || ieeeIssn()),
    isbn: text(meta("citation_isbn", "prism.isbn") || (ieee ? ieee.isbn : "")),
    institution: text(meta("citation_dissertation_institution", "citation_technical_report_institution", "eprints.institution")),
    url,
    pageUrl: location.href,
    siteName,
    hasScholarTags: metas("citation_title").length > 0 || metas("bepress_citation_title").length > 0 || Boolean(ieee),
    isConference: metas("citation_conference_title").length > 0 || Boolean(ieee && ieee.isConference),
    isPreprint: /arxiv\.org|biorxiv|medrxiv|ssrn|preprints?\.org|osf\.io|researchsquare/i.test(location.hostname)
  };
})();
