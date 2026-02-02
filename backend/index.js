const { createServer } = require("./server");

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const server = createServer();
server.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
