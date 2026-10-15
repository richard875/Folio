export type ArticleImage = { alt: string; src: string };

export type ArticleResult = {
  title: string;
  author: string;
  published: string;
  originalUrl: string;
  text: string;
  markdown: string;
  images: ArticleImage[];
  partial: boolean;
  /** The actual URL that was fetched (may differ from originalUrl for redirected sources like archive.is/newest). */
  sourceUrl?: string;
};
