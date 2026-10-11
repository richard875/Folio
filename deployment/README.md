# Oracle Cloud: persistent Node server

The app now builds using Nitro's `node-server` preset, with production output
under `.output/`, rather than generating a Vercel serverless application.
Use Node.js 22.9+ (or a newer supported LTS) on your Oracle VM.

From the project directory:

```sh
npm ci
npm run build
npm start
```

`npm start` runs `.output/server/index.mjs` and loads the project-root `.env` if
present. The server stays running and handles `/api/read`, `/api/save`, and
`/api/links` on demand; it does not run a collection loop or a scheduler.
Environment variables take precedence over `.env`.

## Automatic start and restart

`deployment/folio.service` is a systemd example for a deployment at `/opt/folio`.
Create a dedicated `folio` system user, install the repository at that path,
and ensure it can write `output/articles` and `output/links`. Restrict `.env`
permissions to that user. Verify `/usr/bin/npm` is your npm executable; adjust
the unit if you use a different installation path. Build as the deployment
user so generated output is readable by the service.

Install the service as an administrator:

```sh
sudo cp deployment/folio.service /etc/systemd/system/folio.service
sudo systemctl daemon-reload
sudo systemctl enable --now folio
```

The unit starts after networking is available, restarts the process if it stops,
and starts it again after a VM reboot. It listens on `127.0.0.1:3000` behind
your HTTPS reverse proxy. Configure Caddy or Nginx to proxy your domain to it.
RSS requests can take several minutes (worst case roughly an hour if every
attempt times out with default retries). Configure the client and proxy timeout
accordingly, or reduce `FETCH_RETRY_LIMIT`. Avoid retries of whole API requests
by proxies: a collection may still be running after a client disconnects.

The service is supplied as configuration, not installed automatically by this
repository. Keep output on persistent VM storage and back it up. To deploy an
update, rebuild and restart the service. Do not place `output/` inside a public
web directory. Keep the `.env`, access key, and output files out of version control.
