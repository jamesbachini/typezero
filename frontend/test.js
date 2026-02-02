const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
if (!html.includes("TypeZERO")) {
  console.error("index.html missing TypeZERO heading");
  process.exit(1);
}

console.log("frontend test ok");
