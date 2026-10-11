import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handleSaveRequest } from "./save-api.ts";
import { articleNames, saveArticle } from "./save.ts";
import type { ArticleResult } from "./types.ts";

const article: ArticleResult = {
  title: "One Two Three Four Five Six",
  author: "Example Author",
  published: "2026-10-11",
  originalUrl: "https://www.reuters.com/world/example-story/",
  text: "Article text.",
  markdown: "## Article\n\nArticle text.\n",
  images: [],
  partial: false,
};

test("infers website and section names and handles date paths and opaque URLs", () => {
  assert.deepEqual(articleNames(article.originalUrl), { website: "reuters", section: "world" });
  assert.deepEqual(articleNames("https://www.nytimes.com/2026/10/11/world/story.html"), {
    website: "ny_times",
    section: "world",
  });
  assert.deepEqual(articleNames("https://www.ft.com/content/article-id"), {
    website: "financial_times",
    section: "general",
  });
  assert.deepEqual(articleNames("https://example.com/story.html"), {
    website: "example_com",
    section: "general",
  });
});

test("creates hourly directories, saves Markdown and adds files without overwriting", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "folio-articles-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let date = new Date("2026-10-11T23:59:59Z");
  const options = { outputDir: dir, now: () => date };
  const first = await saveArticle(article, options);
  assert.equal(
    first,
    "output/articles/2026-10-11_23/reuters_world_one_two_three_four_five_23-59-59.md",
  );
  const original = await readFile(join(dir, "2026-10-11_23", first.split("/").at(-1)!), "utf8");
  assert.equal(original, article.markdown);
  const second = await saveArticle(article, {
    ...options,
    wait: async () => {
      date = new Date(date.getTime() + 1000);
    },
  });
  assert.equal(
    second,
    "output/articles/2026-10-12_00/reuters_world_one_two_three_four_five_00-00-00.md",
  );
  assert.equal(
    await readFile(join(dir, "2026-10-11_23", first.split("/").at(-1)!), "utf8"),
    original,
  );
  await saveArticle({ ...article, title: "Another article" }, options);
  assert.equal((await readdir(join(dir, "2026-10-12_00"))).length, 2);
});

test("saves JSON with sanitized names and no internal fetching fields", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "folio-articles-json-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = await saveArticle(article, {
    outputDir: dir,
    format: "json",
    website: "../../My News",
    section: "../../Markets / Finance",
    now: () => new Date("2026-10-11T14:23:45Z"),
  });
  assert.equal(
    path,
    "output/articles/2026-10-11_14/my_news_markets_finance_one_two_three_four_five_14-23-45.json",
  );
  const content = await readFile(join(dir, "2026-10-11_14", path.split("/").at(-1)!), "utf8");
  assert.deepEqual(JSON.parse(content), article);
  assert.doesNotMatch(content, /methodUrl|bypass|ACCESS_HASH/);
});

test("API saves before returning the article and supplies the relative path header", async () => {
  let saved = false;
  const response = await handleSaveRequest(
    new Request(
      "http://localhost/api/save?url=https%3A%2F%2Fexample.com%2Fstory&hash=test&section=World&website=Example",
    ),
    {
      read: async (url, hash) => {
        assert.equal(url, "https://example.com/story");
        assert.equal(hash, "test");
        return article;
      },
      save: async (value, options) => {
        assert.deepEqual(value, article);
        assert.equal(options?.section, "World");
        assert.equal(options?.website, "Example");
        saved = true;
        return "output/articles/example.md";
      },
    },
  );
  assert.equal(saved, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-saved-file"), "output/articles/example.md");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), article.markdown);
});

test("API returns and saves JSON and uses HTTP 206 for partial articles", async () => {
  const partial = { ...article, partial: true };
  const response = await handleSaveRequest(new Request("http://localhost/api/save?format=json"), {
    read: async () => partial,
    save: async (_, options) => {
      assert.equal(options?.format, "json");
      return "output/articles/example.json";
    },
  });
  assert.equal(response.status, 206);
  assert.deepEqual(await response.json(), partial);
});

test("unauthorized and failed reads never write files", async () => {
  for (const status of [401, 422]) {
    const response = await handleSaveRequest(new Request("http://localhost/api/save?format=json"), {
      read: async () => {
        throw Object.assign(new Error("Read failed"), { status });
      },
      save: async () => {
        assert.fail("Must not save a failed read");
      },
    });
    assert.equal(response.status, status);
  }
});

test("write errors return HTTP 500 without exposing filesystem details", async () => {
  const response = await handleSaveRequest(new Request("http://localhost/api/save?format=json"), {
    read: async () => article,
    save: async () => {
      throw new Error("EACCES: /private/server/path");
    },
  });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("x-saved-file"), null);
  assert.deepEqual(await response.json(), {
    error: "Unable to save the article. Please try again later.",
  });
});

test("the real API rejects missing credentials before creating output", async () => {
  const response = await handleSaveRequest(
    new Request("http://localhost/api/save?url=https%3A%2F%2Fexample.com&format=json"),
  );
  assert.equal(response.status, 401);
});
