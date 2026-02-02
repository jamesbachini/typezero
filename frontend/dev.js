const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const rootDir = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".map": "application/json; charset=utf-8",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const rel = decoded === "/" ? "/index.html" : decoded;
  const fullPath = path.join(rootDir, rel);
  if (!fullPath.startsWith(rootDir)) {
    return null;
  }
  return fullPath;
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("method not allowed\n");
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const filePath = safePath(url.pathname);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("forbidden\n");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found\n");
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`frontend listening on http://localhost:${port}`);
});
