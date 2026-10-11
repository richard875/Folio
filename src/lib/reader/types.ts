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
};
