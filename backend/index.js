const http = require("http");

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("hello from backend\n");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found\n");
});

server.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
