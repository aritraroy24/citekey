/* Getting the bytes of the PDF the user is looking at.

   Harder than it sounds. Chrome renders a PDF inside an internal viewer, so the tab's DOM holds
   no text to read and no way to reach the file. Three routes, tried in order:

     1. Fetch it from inside the page. The tab already has the file in its HTTP cache along with
        whatever cookies and referer got it past the door, so this works on sites that refuse
        anonymous requests — ResearchGate, Academia.edu, and most publisher CDNs behind a bot
        check. activeTab grants the injection for the tab the user clicked on.
     2. Let the user pick the file. Always works, including for PDFs already on disk, and needs
        no permissions at all.

   A third route — fetching the file from the popup — would need permission for arbitrary
   origins, and is deliberately not taken: the two routes above cover the same ground without
   widening what the extension may reach.

   Bytes cross from the page as base64 because chrome.scripting serialises results as JSON, and a
   binary buffer does not survive that. */

const MAX_BYTES = 30 * 1024 * 1024;

/** Runs in the page. Returns base64 of the PDF, or a reason it could not. */
function fetchInPage(maxBytes) {
  return (async () => {
    try {
      const response = await fetch(location.href, { credentials: "include", cache: "force-cache" });
      if (!response.ok) return { ok: false, reason: "The page returned " + response.status + "." };

      const type = response.headers.get("content-type") || "";
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxBytes) return { ok: false, reason: "That PDF is too large to read here." };

      const bytes = new Uint8Array(buffer);
      const header = String.fromCharCode(...bytes.slice(0, 5));
      if (header !== "%PDF-" && !type.includes("pdf")) {
        return { ok: false, reason: "That link did not return a PDF." };
      }

      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return { ok: true, base64: btoa(binary), bytes: bytes.length };
    } catch (error) {
      return { ok: false, reason: error && error.message ? error.message : "The page refused the request." };
    }
  })();
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Does this tab look like a PDF rather than a web page? */
export function looksLikePdfUrl(url) {
  return /\.pdf($|[?#])/i.test(String(url || "")) || /\/pdf\/|pdfdirect|\/doi\/pdf\//i.test(String(url || ""));
}

/** Route 1: fetch from inside the tab. */
export async function bytesFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: fetchInPage,
    args: [MAX_BYTES],
    world: "MAIN"
  });

  const result = results && results[0] && results[0].result;
  if (!result) throw new Error("The PDF viewer would not let the extension read this tab.");
  if (!result.ok) throw new Error(result.reason);
  return fromBase64(result.base64);
}

/** Route 2: whatever file the user picked. */
export async function bytesFromFile(file) {
  if (!file) throw new Error("No file chosen.");
  if (file.size > MAX_BYTES) throw new Error("That PDF is too large to read here.");
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * Try the automatic routes in order, collecting why each failed so the popup can explain itself
 * before falling back to asking the user for the file.
 */
export async function bytesForTab(tab) {
  try {
    return { bytes: await bytesFromTab(tab.id), via: "page" };
  } catch (error) {
    throw new Error("Could not read the PDF from the tab — " + error.message);
  }
}
