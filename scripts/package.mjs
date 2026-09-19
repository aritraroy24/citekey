/* Build the upload zip: exactly the files the extension ships, nothing else.
   Run with `npm run package`.

   The archive is written here rather than shelled out to `zip` or PowerShell's Compress-Archive:
   Compress-Archive writes backslash-separated entry names, which violates the zip spec and which
   the Chrome Web Store has been known to reject, and `zip` is not installed everywhere. */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));

/* Only these reach the browser. Tests, node_modules, docs and dotfiles stay out. */
const SHIPPED = ["manifest.json", "src", "icons", "_locales"];

/* ---------- zip writing ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** DOS date/time, as the zip central directory wants it. */
function dosStamp(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zip(files, date = new Date()) {
  const { time, day } = dosStamp(date);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf8");
    const deflated = deflateRawSync(file.data, { level: 9 });
    // Stored beats deflated for tiny or incompressible files.
    const useDeflate = deflated.length < file.data.length;
    const body = useDeflate ? deflated : file.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: regular file, rw-r--r--
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuffer, end]);
}

/* ---------- collect and write ---------- */

/** Every shipped file, as zip entries with forward-slash paths. */
function collect(relative, out = []) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) throw new Error("missing from the build: " + relative);
  if (statSync(absolute).isDirectory()) {
    for (const child of readdirSync(absolute).sort()) collect(path.posix.join(relative, child), out);
  } else {
    out.push({ name: relative.split(path.sep).join("/"), data: readFileSync(absolute) });
  }
  return out;
}

const files = SHIPPED.flatMap((item) => collect(item));
const dist = path.join(root, "dist");
const target = path.join(dist, "citekey-" + manifest.version + ".zip");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(target, zip(files));

const bytes = statSync(target).size;
console.log("Packaged " + path.relative(root, target) + " (" + (bytes / 1024).toFixed(1) + " KB)");
for (const file of files) console.log("  " + file.name);
