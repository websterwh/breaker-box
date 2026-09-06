import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import config from "../plugin.config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  await import("fs").then((fs) =>
    fs.readFileSync(resolve(__dirname, "../package.json"), "utf-8")
  )
);

const manifest = {
  name: config.name,
  displayName: config.displayName,
  description: config.description,
  version: pkg.version,
  icon: config.icon,
  author: config.author,
  homepage: config.homepage,
};

writeFileSync(
  resolve(__dirname, "../dist/manifest.json"),
  JSON.stringify(manifest, null, 2)
);

console.log("Wrote dist/manifest.json");
