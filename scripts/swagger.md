# Hash-protected Swagger UI

Open `/api/docs?hash=YOUR_ACCESS_HASH` in a browser. The reader's API
documentation popup also has an **Open Swagger UI** link once an access key is
entered. Invalid or missing hashes return HTTP 401 before documentation loads.

The OpenAPI 3.0.3 document is available at `/api/openapi?hash=YOUR_ACCESS_HASH`.
Documentation, specification and local assets also accept
`Authorization: Bearer YOUR_ACCESS_HASH`. Every application endpoint is
documented, including supported GET/POST variants, query parameters, formats,
job statuses, file paths, agent pagination, checksums and error responses.

Swagger starts authorized with the key used to open it. **Try it out** uses
the existing `hash` query authentication and targets only this same server.
It does not automatically execute article reads, saves, RSS collection or jobs.
Save/collection operations create files; run them only intentionally.

Assets are bundled from `swagger-ui-dist`, served locally behind the same hash,
and loaded using authenticated requests. No CDN or remote schema validator is
used. API responses and documentation assets are non-cacheable. Swagger auth is
not persisted in browser storage. The initial hash is removed from the browser
address bar after the UI loads and referrers are disabled; the initial request
may still appear in HTTP access logs. Do not share those logs or expose the key.
Use HTTPS outside local development.

Authentication is documented as the `AccessHash` API-key security scheme.
Agent/documentation endpoints additionally support the `BearerHash` scheme;
the original read/save/collection endpoints continue using their existing query
hash interface. No accounts, database or additional authentication service were
introduced.

The specification is maintained in `src/lib/swagger/openapi.ts`. Update it when
API contracts change. No real access hash is included in the specification.
