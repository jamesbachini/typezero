const fs = require("node:fs");
const path = require("node:path");
const { createServer } = require("./server");

function loadConfigFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `Invalid JSON in ${filePath}: ${err.message || "parse error"}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file ${filePath} must contain a JSON object.`);
  }
  return parsed;
}

function applyConfig(config) {
  for (const [key, value] of Object.entries(config)) {
    if (process.env[key] !== undefined) {
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "object") {
      throw new Error(
        `Config value for ${key} must be a string, number, or boolean.`
      );
    }
    process.env[key] = String(value);
  }
}

const config = loadConfigFile(path.join(__dirname, "config.json"));
applyConfig(config);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const server = createServer();
server.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
