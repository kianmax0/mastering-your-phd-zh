import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete book reader", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /掌控你的博士生涯/);
  assert.match(html, /博士岁月及未来的生存与成功/);
  assert.match(html, /Patricia Gosling/);
  assert.match(html, /Bart Noordam/);
  assert.match(html, /aria-controls="reader-search-dialog"/);
  assert.match(html, /仅供个人学习与研究/);
  assert.match(html, /class="reader-chapter/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|SkeletonPreview/);
});

test("ships sanitized chapters and required reading assets", async () => {
  const [bookData, reader, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/book-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/Reader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.equal((bookData.match(/^\s+"id":/gm) ?? []).length, 30);
  assert.match(bookData, /export const chapters: Chapter\[\]/);
  assert.match(bookData, /"cover": "book\/images\/cover\.png"/);
  assert.doesNotMatch(bookData, /<script\b|\son[a-z]+=/i);
  assert.match(reader, /localStorage/);
  assert.match(reader, /IntersectionObserver/);
  assert.match(reader, /reader-search-dialog/);
  assert.match(layout, /openGraph/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await Promise.all([
    access(new URL("../public/book/images/cover.png", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
    access(new URL("../scripts/extract_epub.py", import.meta.url)),
  ]);
});
