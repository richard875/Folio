import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

export class ArticleAccessError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type CollectionRecord = {
  callId: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  saved?: number;
  failed?: number;
  results?: { savedFile?: string; partial?: boolean }[];
};

export type StoredArticle = {
  filename: string;
  mediaType: string;
  bytes: number;
  characters: number;
  sha256: string;
  partial: boolean;
  content: string;
};

export type ArticleSnapshot = {
  folder: string;
  snapshotId: string;
  articles: StoredArticle[];
  collections: CollectionRecord[];
  pendingCollections: number;
};

export function validArticleFolder(folder: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})_(\d{2})(?:-(\d{2}))?$/.exec(folder);
  if (!match) return false;
  const iso = `${match[1]}T${match[2]}:${match[3] ?? "00"}:00.000Z`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso;
}

function foldersFor(record: CollectionRecord): Set<string> {
  const folders = new Set<string>();
  const date = new Date(record.startedAt);
  if (Number.isFinite(date.getTime())) {
    const iso = date.toISOString();
    folders.add(`${iso.slice(0, 10)}_${iso.slice(11, 16).replace(":", "-")}`);
  }
  for (const result of record.results || []) {
    const match = /^output\/articles\/([^/]+)\/[^/]+$/.exec(result.savedFile || "");
    if (match && validArticleFolder(match[1])) folders.add(match[1]);
  }
  return folders;
}

function isUnfinished(record: CollectionRecord): boolean {
  return record.status === "in progress" || !record.finishedAt;
}

async function collections(root: string): Promise<CollectionRecord[]> {
  let entries;
  try {
    entries = await readdir(resolve(root, "output/jobs"), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: CollectionRecord[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new ArticleAccessError(503, "Unable to verify collection progress.");
    const record = JSON.parse(
      await readFile(resolve(root, "output/jobs", entry.name), "utf8"),
    ) as CollectionRecord;
    if (
      typeof record.callId !== "string" ||
      typeof record.startedAt !== "string" ||
      !["in progress", "completed", "partial", "error"].includes(record.status)
    ) {
      throw new ArticleAccessError(503, "Unable to verify collection progress.");
    }
    records.push(record);
  }
  return records;
}

function articleFile(name: string): boolean {
  return !name.startsWith(".") && /\.(md|json|txt)$/i.test(name);
}

async function articleNames(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!articleFile(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new ArticleAccessError(409, "The article folder contains an unsafe file.");
    names.push(entry.name);
  }
  return names.sort();
}

export class ArticleStore {
  private readonly root: string;
  constructor(root = process.cwd()) {
    this.root = resolve(root);
  }

  async latest(): Promise<ArticleSnapshot> {
    const records = await collections(this.root);
    let entries;
    try {
      entries = await readdir(resolve(this.root, "output/articles"), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new ArticleAccessError(404, "No saved article folder is available.");
      throw error;
    }
    const candidates = entries
      .filter(
        (entry) => entry.isDirectory() && !entry.isSymbolicLink() && validArticleFolder(entry.name),
      )
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const folder of candidates) {
      if (records.some((record) => isUnfinished(record) && foldersFor(record).has(folder)))
        continue;
      const snapshot = await this.snapshot(folder);
      if (snapshot.articles.length) return snapshot;
    }
    throw new ArticleAccessError(
      records.some(isUnfinished) ? 409 : 404,
      "No finished, non-empty article folder is available.",
    );
  }

  async snapshot(folder: string, expectedSnapshot?: string): Promise<ArticleSnapshot> {
    if (!validArticleFolder(folder)) throw new ArticleAccessError(400, "Invalid article folder.");
    const records = await collections(this.root);
    if (records.some((record) => isUnfinished(record) && foldersFor(record).has(folder))) {
      throw new ArticleAccessError(
        409,
        "This article folder is still being written. Retry after the collection finishes.",
      );
    }
    const root = resolve(this.root, "output/articles");
    const directory = resolve(root, folder);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new ArticleAccessError(400, "Invalid article folder.");
      const [realRoot, realDirectory] = await Promise.all([realpath(root), realpath(directory)]);
      if (!realDirectory.startsWith(`${realRoot}${sep}`))
        throw new ArticleAccessError(400, "Invalid article folder.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new ArticleAccessError(404, "Article folder not found.");
      throw error;
    }
    const names = await articleNames(directory);
    const relevant = records.filter((record) => foldersFor(record).has(folder));
    const partialFiles = new Set(
      relevant.flatMap((record) =>
        (record.results || [])
          .filter((result) => result.partial)
          .map((result) => basename(result.savedFile || "")),
      ),
    );
    const articles: StoredArticle[] = [];
    for (const filename of names) {
      const handle = await open(
        resolve(directory, filename),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const before = await handle.stat();
        if (!before.isFile())
          throw new ArticleAccessError(
            409,
            "The article folder changed. Restart from the latest manifest.",
          );
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          bytes.length !== after.size
        ) {
          throw new ArticleAccessError(
            409,
            "The article folder changed. Restart from the latest manifest.",
          );
        }
        const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        const json = filename.toLowerCase().endsWith(".json");
        let partial =
          partialFiles.has(filename) ||
          content.includes("**Note:** Text looks short or incomplete.");
        if (json) {
          try {
            const parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
            partial ||= parsed?.partial === true;
          } catch {
            throw new ArticleAccessError(
              409,
              "An article file contains invalid JSON. Repair it before reading this folder.",
            );
          }
        }
        articles.push({
          filename,
          mediaType: json
            ? "application/json"
            : filename.endsWith(".txt")
              ? "text/plain"
              : "text/markdown",
          bytes: bytes.length,
          characters: Array.from(content).length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          partial,
          content,
        });
      } finally {
        await handle.close();
      }
    }
    const afterNames = await articleNames(directory);
    const afterRecords = await collections(this.root);
    if (
      JSON.stringify(names) !== JSON.stringify(afterNames) ||
      afterRecords.some((record) => isUnfinished(record) && foldersFor(record).has(folder))
    ) {
      throw new ArticleAccessError(
        409,
        "The article folder changed. Restart from the latest manifest.",
      );
    }
    const snapshotId = createHash("sha256")
      .update(JSON.stringify([folder, articles.map(({ filename, sha256 }) => [filename, sha256])]))
      .digest("hex");
    if (expectedSnapshot && expectedSnapshot !== snapshotId) {
      throw new ArticleAccessError(
        409,
        "Snapshot changed. Restart from /api/agent/latest; do not mix article versions.",
      );
    }
    return {
      folder,
      snapshotId,
      articles,
      collections: relevant,
      pendingCollections: afterRecords.filter(isUnfinished).length,
    };
  }
}

export const articleStore = new ArticleStore();
