import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { validateContent } from "../src/content/validate.js";
import { APP_RELEASE_NOTES, APP_VERSION } from "../src/presentation/version.js";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const packageDocument = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (packageDocument.version !== APP_VERSION) throw new Error(`package.json版本${packageDocument.version}与应用版本${APP_VERSION}不一致`);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ["index.html", "help.html", "README.md", "src"]) await cp(new URL(`../${name}`, import.meta.url), new URL(`../dist/${name}`, import.meta.url), { recursive: true });

for (const name of ["index.html", "help.html"]) {
  const target = new URL(`../dist/${name}`, import.meta.url);
  const html = (await readFile(target, "utf8"))
    .replaceAll("./src/presentation/styles.css", `./src/presentation/styles.css?v=${APP_VERSION}`)
    .replaceAll("./src/presentation/app.js", `./src/presentation/app.js?v=${APP_VERSION}`);
  await writeFile(target, html);
}
await writeFile(new URL("../dist/app-version.json", import.meta.url), `${JSON.stringify({ version: APP_VERSION, notes: APP_RELEASE_NOTES }, null, 2)}\n`);

const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
const moduleMatch = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(index);
const styleMatch = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(index);
const helpMatch = /<a[^>]+class="help-link"[^>]+href="([^"]+)"/.exec(index);
if (!moduleMatch || !styleMatch || !helpMatch) throw new Error("构建产物缺少模块、样式或玩法说明入口");
for (const asset of [moduleMatch[1], styleMatch[1], helpMatch[1]]) await stat(new URL(asset.replace(/^\.\//, "").split("?")[0], dist));

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
