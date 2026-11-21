import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let checked = 0;
function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) check(path);
    else if (/\.m?js$/.test(entry.name)) {
      execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
      checked++;
    }
  }
}
for (const directory of ["src", "scripts", "test"]) check(resolve(root, directory));
console.log(`Syntax checked ${checked} server source, diagnostic and test files.`);
