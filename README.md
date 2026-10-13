# Folio

Folio is a private article reader and news-collection API. It extracts readable article content, collects links from configured feeds, and saves Markdown or JSON for later retrieval by people and agents.

Built with React 19, TypeScript, TanStack Start, Tailwind CSS, and Nitro. The current deployment is file-backed; no database or account system is required.

## Features

- Browser-based article reading with title, author, publication date, and partial-content indicators.
- RSS, Atom, and news-sitemap collection with publisher URL resolution.
- Background collection jobs with progress polling and bounded execution.
- Saved-article manifests and paginated agent retrieval with SHA-256 verification.
- Interactive Swagger documentation and an OpenAPI specification.

Article extraction relies on third-party archive and retrieval services; availability and completeness vary.

## Getting started

Use **Node.js 24.20.0** (see `.node-version`) and npm.

```sh
npm ci
export ACCESS_HASH="$(openssl rand -hex 32)"
npm run dev
```

Open `http://localhost:8080`, enter an article URL, and use the generated `ACCESS_HASH` as the access key. Keep the same key configured across restarts if you want clients to continue working.

See [`.env.example`](.env.example) for configuration options. Keep `VITE_AUTH_ENABLED=false` and leave `DATABASE_URL` unset for the current file-backed deployment. Never commit access keys or expose them through `VITE_` variables.

## API

The home page includes an **API documentation** control. Swagger is served at `/api/docs`, with the specification at `/api/openapi`; both require the access key.

| Endpoint | Purpose |
| --- | --- |
| `/api/read` | Extract an article as Markdown or JSON |
| `/api/save` | Extract and save an article |
| `/api/links` | Collect and save a feed-links report |
| `/api/collect` | Start a background collection; prefer POST |
| `/api/collect/status` | Poll a job using its `callId` |
| `/api/agent/latest` | Retrieve a saved-article manifest |
| `/api/agent/read` | Retrieve checksum-verifiable article content |

Most endpoints authenticate through the `hash` query parameter; agent endpoints also accept Bearer authentication. Treat URLs containing the key as secrets. `/healthz` is public; `/api/health` is authenticated.

## Development and deployment

```sh
npm run lint
npm test
npm run typecheck
npm run build
npm start
```

`npm start` serves the production build on `PORT` (default `3000`) and requires an `ACCESS_HASH` of at least 32 characters. `npm run test:production` runs a disposable production smoke test; browser checks require Playwright Chromium.

Source routes live in `src/routes/`, extraction and collection logic in `src/lib/`, and operational tools in `scripts/`. Generated articles, link reports, and job records are written under `output/`.

The Render Blueprint is defined in [`render.yaml`](render.yaml). **Render Free storage is temporary:** articles and job history can be lost on sleep, restart, or redeployment. Collections are best-effort and do not automatically resume after interruption. Archive important output separately.

See [deployment.md](deployment.md) for deployment setup, resource limits, history import, and release verification.
