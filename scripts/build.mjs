// Build di rilascio senza dipendenze: copia il sito in dist/ dando a JS e CSS un nome
// con l'hash del contenuto (app.3f9c1a2b.js). Gli import tra moduli vengono riscritti,
// quindi basta che cambi un file perché cambi il nome suo e di chi lo importa:
// al refresh i browser scaricano solo i file nuovi, il resto resta in cache.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist");

const hash = (content) => crypto.createHash("sha256").update(content).digest("hex").slice(0, 10);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function write(rel, content) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function hashedName(rel, content) {
  const ext = path.extname(rel);
  return `${rel.slice(0, -ext.length)}.${hash(content)}${ext}`;
}

/**
 * js/config.js: ogni valore viene dalle variabili FW_* della pipeline se presenti,
 * altrimenti da quello scritto in js/config.js.
 */
function configSource() {
  const env = process.env;
  const sandbox = { window: {} };
  vm.runInNewContext(read("js/config.js"), sandbox);
  const base = sandbox.window.FAMILY_WALLET_CONFIG;
  const pick = (name, fallback) => env[name] || fallback || "";
  const config = {
    google: { clientId: pick("FW_GOOGLE_CLIENT_ID", base.google?.clientId) },
    microsoft: { clientId: pick("FW_MICROSOFT_CLIENT_ID", base.microsoft?.clientId) },
    push: {
      workerUrl: pick("FW_PUSH_WORKER_URL", base.push?.workerUrl).replace(/\/$/, ""),
      vapidPublicKey: pick("FW_VAPID_PUBLIC_KEY", base.push?.vapidPublicKey),
    },
  };
  return `window.FAMILY_WALLET_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
}

// ---------- moduli JS: hash in ordine di dipendenza ----------

const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\/[^"']+\.js)\2/g;
const done = new Map(); // "js/app.js" -> "js/app.1a2b3c4d5e.js"
const visiting = new Set();

function buildModule(rel) {
  if (done.has(rel)) return done.get(rel);
  if (visiting.has(rel)) throw new Error(`Import circolare su ${rel}: non gestito dal build`);
  visiting.add(rel);

  const dir = path.posix.dirname(rel);
  const source = rel === "js/config.js" ? configSource() : read(rel);
  const rewritten = source.replace(IMPORT_RE, (_, prefix, quote, spec) => {
    const dep = path.posix.join(dir, spec);
    const depHashed = buildModule(dep);
    return `${prefix}${quote}./${path.posix.relative(dir, depHashed)}${quote}`;
  });

  const name = hashedName(rel, rewritten);
  write(name, rewritten);
  visiting.delete(rel);
  done.set(rel, name);
  return name;
}

// ---------- build ----------

fs.rmSync(out, { recursive: true, force: true });

let html = read("index.html");
const assets = {
  "css/style.css": () => {
    const css = read("css/style.css");
    const name = hashedName("css/style.css", css);
    write(name, css);
    return name;
  },
  "js/config.js": () => buildModule("js/config.js"),
  "js/app.js": () => buildModule("js/app.js"),
};
for (const [rel, build] of Object.entries(assets)) {
  if (!html.includes(`"${rel}"`)) throw new Error(`index.html non contiene ${rel}`);
  html = html.replace(`"${rel}"`, `"${build()}"`);
}

// file statici con nome fisso (cambiano di rado e il manifest li cita per nome)
// sw.js deve mantenere il suo nome (il browser lo registra per indirizzo)
for (const rel of ["icon.svg", "icon-maskable.svg", "manifest.webmanifest", "sw.js"]) fs.copyFileSync(path.join(root, rel), path.join(out, rel));
write("index.html", html);
write("404.html", html); // eventuali URL sbagliati tornano all'app
write(".nojekyll", ""); // pubblica i file così come sono

const files = fs.readdirSync(out, { recursive: true }).filter((f) => fs.statSync(path.join(out, f)).isFile());
console.log(`Build completata in dist/ (${files.length} file):`);
for (const f of files.sort()) console.log(`  ${f.replaceAll("\\", "/")}`);
