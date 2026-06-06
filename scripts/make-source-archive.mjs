import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const outputPath = resolve(
  root,
  process.argv[2] ?? `artifacts/yukari_rubi-source-${pkg.version}.tar.gz`,
);

mkdirSync(dirname(outputPath), { recursive: true });

const tarball = execFileSync(
  "git",
  ["archive", "--worktree-attributes", "--format=tar", "--prefix=yukari-rubi/", "HEAD"],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  },
);

writeFileSync(outputPath, gzipSync(tarball));
console.log(`✅ Wrote source archive to ${outputPath}`);
