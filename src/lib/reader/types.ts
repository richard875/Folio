export type ArticleImage = { alt: string; src: string };

export type ArticleResult = {
  title: string;
  author: string;
  published: string;
  originalUrl: string;
  method: string;
  methodUrl: string;
  text: string;
  markdown: string;
  images: ArticleImage[];
  partial: boolean;
};

export type Attempt = { method: string; url: string; ok: boolean; note: string };
