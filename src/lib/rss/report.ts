import { z } from "zod";

export const linksReportPath = /^output\/links\/links_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/;

const article = z.object({
  url: z.string().url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }, "Expected an HTTP(S) URL without credentials"),
  summary: z.string().min(1).max(1000).optional(),
}).strict();

/** Shared disk, API, collection and import contract. No rendered presentation data. */
export const linksReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  savedFile: z.string().regex(linksReportPath),
  limit: z.number().int().min(1).max(100),
  feedCount: z.number().int().nonnegative(),
  failedFeedCount: z.number().int().nonnegative(),
  linkCount: z.number().int().nonnegative(),
  websites: z.array(
    z.object({
      name: z.string().trim().min(1),
      sections: z.array(
        z.object({
          name: z.string().trim().min(1),
          available: z.boolean(),
          articles: z.array(article),
        }).strict(),
      ),
    }).strict(),
  ),
}).strict().superRefine((report, context) => {
  const sections = report.websites.flatMap((website) => website.sections);
  const count = sections.reduce((sum, section) => sum + section.articles.length, 0);
  if (
    count !== report.linkCount ||
    report.failedFeedCount > report.feedCount ||
    sections.some((section) => section.articles.length > report.limit)
  ) {
    context.addIssue({ code: "custom", message: "Inconsistent link report counts or limit" });
  }
});

export type LinksReport = z.infer<typeof linksReportSchema>;

export function parseLinksReport(content: string): LinksReport {
  return linksReportSchema.parse(JSON.parse(content));
}
