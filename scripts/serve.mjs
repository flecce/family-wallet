// Server statico minimo per provare l'app in locale: node scripts/serve.mjs [cartella] [porta]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? process.env.PORT ?? 8080);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Non trovato");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Family Wallet su http://localhost:${port} (cartella ${dir})`));
