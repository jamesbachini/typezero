const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const indexPath = path.join(__dirname, "index.html");

const server = http.createServer((req, res) => {
  if (req.url === "/" && req.method === "GET") {
    const html = fs.readFileSync(indexPath);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found\n");
});

server.listen(port, () => {
  console.log(`frontend listening on http://localhost:${port}`);
});
