import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { validateContent } from "../src/content/validate.js";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ["index.html", "help.html", "README.md", "src"]) await cp(new URL(`../${name}`, import.meta.url), new URL(`../dist/${name}`, import.meta.url), { recursive: true });

const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
const moduleMatch = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(index);
const styleMatch = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(index);
const helpMatch = /<a[^>]+class="help-link"[^>]+href="([^"]+)"/.exec(index);
if (!moduleMatch || !styleMatch || !helpMatch) throw new Error("构建产物缺少模块、样式或玩法说明入口");
for (const asset of [moduleMatch[1], styleMatch[1], helpMatch[1]]) await stat(new URL(asset.replace(/^\.\//, ""), dist));

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path)); else files.push(path);
  }
  return files;
}
const files = await walk(new URL("../dist", import.meta.url).pathname);
for (const file of files.filter((path) => path.endsWith(".js"))) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const target = new URL(match[1], `file://${file}`);
    await stat(target);
  }
}
validateContent();
console.log(JSON.stringify({ status: "passed", output: "dist", files: files.map((file) => relative(new URL("../dist", import.meta.url).pathname, file)).sort(), entry: moduleMatch[1] }, null, 2));
