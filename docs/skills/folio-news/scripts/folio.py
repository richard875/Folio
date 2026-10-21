#!/usr/bin/env python3
"""Bounded Folio-only client. Secrets are environment-only; no automatic retries."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse as url
import urllib.request

MAX_RESPONSE = 5 * 1024 * 1024
TIMEOUT = 180
HEX = re.compile(r"[a-f0-9]{64}\Z")
FEED = re.compile(r"feed_[a-f0-9]{64}\Z")
QUERIES = {
    "/api/feed-catalog": {"q", "publisher", "limit", "cursor"},
    "/api/feed-fetch": set(),
    "/api/links": set(),
    "/api/save-batch": set(),
    "/api/save-batch/status": {"callId"},
    "/api/agent/latest": {"folder", "snapshot", "offset", "limit"},
    "/api/agent/read": {"folder", "snapshot", "file", "offset", "limit"},
}


class FolioError(Exception):
    """Errors intentionally contain no remote body, authenticated URL or secret."""


def require(condition, message="Invalid Folio response or input."):
    if not condition:
        raise FolioError(message)


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def basename(value):
    require(isinstance(value, str) and value and not value.startswith(".")
            and not any(c in value for c in '/\\:\x00')
            and all(ord(c) >= 32 for c in value), "Unsafe article filename.")
    require(value != "verification-ledger.json", "Reserved article filename.")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise FolioError("Redirect rejected; no request was forwarded.")


class Client:
    def __init__(self, origin=None, access_hash=None, opener=None):
        origin = origin if origin is not None else os.environ.get("FOLIO_ORIGIN", "")
        self.key = access_hash if access_hash is not None else os.environ.get("FOLIO_ACCESS_HASH", "")
        require(isinstance(self.key, str) and bool(self.key.strip()),
                "Secure FOLIO_ACCESS_HASH environment configuration is required.")
        try:
            parsed = url.urlsplit(origin)
            require(parsed.scheme == "https" and parsed.hostname and parsed.username is None
                    and parsed.password is None and parsed.path in ("", "/")
                    and not parsed.query and not parsed.fragment
                    and "?" not in origin and "#" not in origin
                    and not any(c.isspace() for c in origin)
                    and "\\" not in origin, "FOLIO_ORIGIN must be an HTTPS root origin.")
            port = parsed.port or 443
            self.identity = (parsed.scheme, parsed.hostname.lower(), port)
            self.origin = url.urlunsplit(("https", parsed.netloc, "", "", ""))
        except ValueError:
            raise FolioError("FOLIO_ORIGIN must be an HTTPS root origin.") from None
        self.opener = opener or urllib.request.build_opener(NoRedirect())

    def safe_url(self, value, path):
        require(path in QUERIES and isinstance(value, str)
                and not any(ord(c) < 33 for c in value) and "\\" not in value,
                "Unsafe API navigation URL.")
        try:
            parsed = url.urlsplit(url.urljoin(self.origin + "/", value))
            require((parsed.scheme, (parsed.hostname or "").lower(), parsed.port or 443)
                    == self.identity and parsed.username is None and parsed.password is None
                    and not parsed.fragment and "#" not in value and parsed.path == path,
                    "API navigation left the allowed origin or endpoint.")
            pairs = url.parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
            require(all(k in QUERIES[path] for k, _ in pairs), "Unexpected API query parameter.")
            keys = [k for k, _ in pairs]
            require(all(keys.count(k) == 1 for k in keys if k not in {"q", "publisher"}),
                    "Duplicate navigation parameter.")
            return url.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
        except ValueError:
            raise FolioError("Malformed API navigation URL.") from None

    def scrub(self, obj):
        # Remove both literal and query-encoded secret if a remote body echoes it.
        if isinstance(obj, str):
            for secret in {self.key, url.quote(self.key, safe=""), url.quote_plus(self.key)}:
                obj = obj.replace(secret, "[REDACTED]")
            return re.sub(r"(?i)([?&]hash=)[^&#\s\"<>]*", r"\1[REDACTED]", obj)
        if isinstance(obj, list):
            return [self.scrub(v) for v in obj]
        if isinstance(obj, dict):
            return {self.scrub(k): self.scrub(v) for k, v in obj.items()}
        return obj

    def request(self, path, method="GET", body=None, navigation=None, params=()):
        target = self.safe_url(navigation or path, path)
        parsed = url.urlsplit(target)
        pairs = url.parse_qsl(parsed.query, keep_blank_values=True) + list(params)
        require(all(k in QUERIES[path] for k, _ in pairs))
        if path == "/api/feed-catalog":
            keywords = [v for k, v in pairs if k == "q"]
            require(len(keywords) <= 12 and all(isinstance(v, str) and 1 <= len(v) <= 80 for v in keywords))
            limits = [str(v) for k, v in pairs if k == "limit"]
            require(not limits or (len(limits) == 1 and limits[0].isdigit() and 1 <= int(limits[0]) <= 100))
        pairs.append(("hash", self.key))
        authenticated = url.urlunsplit((parsed.scheme, parsed.netloc, parsed.path,
                                       url.urlencode(pairs), ""))
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(authenticated, data=data, method=method,
                                     headers={"Accept": "application/json", "Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=TIMEOUT) as response:
                require(response.status in (200, 202), "Unexpected HTTP response.")
                raw = response.read(MAX_RESPONSE + 1)
                require(len(raw) <= MAX_RESPONSE, "API response exceeds 5 MB limit.")
                result = json.loads(raw.decode("utf-8"))
                require(isinstance(result, dict), "Expected a JSON object.")
                return result
        except urllib.error.HTTPError as exc:
            code = exc.code
            exc.close()
            # Do not echo exception, Location, headers or error body (may include hash).
            hint = {401: "Check secure credential configuration.",
                    409: "Stale catalog or snapshot; rediscover, never mix versions.",
                    429: "Busy; wait at least five seconds before an explicit retry.",
                    502: "Upstream feeds failed."}.get(code, "Request failed.")
            raise FolioError("HTTP %s. %s No automatic retry." % (code, hint)) from None
        except (urllib.error.URLError, OSError, TimeoutError, http.client.HTTPException):
            raise FolioError("Network failure or timeout. Submission may be uncertain; no automatic retry.") from None
        except (UnicodeError, ValueError):
            raise FolioError("Invalid JSON/UTF-8 response; no automatic retry.") from None

    def catalog(self, keywords=(), publishers=(), limit=25, next_url=None):
        require(integer(limit, 1, 100), "Catalog limit must be 1–100.")
        require(len(keywords) <= 12 and all(isinstance(k, str) and 1 <= len(k) <= 80 for k in keywords),
                "Use at most 12 literal keywords of 1–80 characters.")
        require(not next_url or (not keywords and not publishers and limit == 25),
                "Use returned next URL without new filters or limits.")
        params = [] if next_url else [("q", k) for k in keywords] + [("publisher", p) for p in publishers] + [("limit", limit)]
        result = self.request("/api/feed-catalog", navigation=next_url, params=params)
        require(result.get("schemaVersion") == 1 and HEX.fullmatch(result.get("catalogVersion", "")))
        if result.get("nextUrl"):
            self.safe_url(result["nextUrl"], "/api/feed-catalog")
        return result

    def fetch(self, body):
        require(isinstance(body, dict) and set(body) == {"catalogVersion", "selections"})
        require(isinstance(body["catalogVersion"], str) and HEX.fullmatch(body["catalogVersion"]))
        selections = body["selections"]
        require(isinstance(selections, list) and 1 <= len(selections) <= 8)
        ids, total = set(), 0
        for item in selections:
            require(isinstance(item, dict) and set(item) == {"feedId", "candidateLimit"})
            fid, limit = item["feedId"], item["candidateLimit"]
            require(isinstance(fid, str) and FEED.fullmatch(fid) and fid not in ids)
            require(integer(limit, 1, 20))
            ids.add(fid)
            total += limit
        require(total <= 100, "Candidate total exceeds 100.")
        return self.request("/api/feed-fetch", "POST", body)

    def save(self, body):
        require(isinstance(body, dict) and set(body) == {"urls", "format"} and body["format"] == "markdown")
        require(isinstance(body["urls"], list) and 1 <= len(body["urls"]) <= 100)
        for item in body["urls"]:
            require(isinstance(item, dict) and set(item) <= {"url", "website", "section"} and "url" in item)
            require(all(isinstance(v, str) for v in item.values()))
            try:
                parsed = url.urlsplit(item["url"])
                require(parsed.scheme in {"http", "https"} and parsed.hostname
                        and parsed.username is None and parsed.password is None and not parsed.fragment)
            except ValueError:
                raise FolioError("Invalid selected article URL.") from None
        result = self.request("/api/save-batch", "POST", body)
        require(isinstance(result.get("callId"), str) and result["callId"])
        endpoint = self.safe_url(result.get("statusEndpoint"), "/api/save-batch/status")
        require(dict(url.parse_qsl(url.urlsplit(endpoint).query)) == {"callId": result["callId"]})
        return result

    def status(self, call_id):
        require(isinstance(call_id, str) and 1 <= len(call_id) <= 200
                and re.fullmatch(r"[A-Za-z0-9_-]+", call_id), "Invalid call ID.")
        result = self.request("/api/save-batch/status", params=[("callId", call_id)])
        require(result.get("callId") == call_id)
        return result

    def pinned(self, value, path, folder, snapshot, filename=None, offset=None):
        target = self.safe_url(value, path)
        query = dict(url.parse_qsl(url.urlsplit(target).query))
        require(query.get("folder") == folder and query.get("snapshot") == snapshot,
                "Snapshot navigation changed pins.")
        if filename is not None:
            require(query.get("file") == filename, "Article navigation changed file.")
        if offset is not None:
            require(query.get("offset", "0") == str(offset), "Navigation offset mismatch.")
        return target

    def read_latest(self, output_dir=None, expected_status=None):
        # Bounds protect against a malicious server generating unending pagination.
        first = self.request("/api/agent/latest")
        folder, snapshot, count = first.get("folder"), first.get("snapshotId"), first.get("articleCount")
        require(isinstance(folder, str) and folder and isinstance(snapshot, str) and HEX.fullmatch(snapshot))
        require(integer(count, 0, 10000), "Invalid or excessive manifest size.")
        articles, seen, page = [], set(), first
        for _ in range(1000):
            require((page.get("folder"), page.get("snapshotId"), page.get("articleCount")) == (folder, snapshot, count))
            require(page.get("manifestOffset") == len(articles), "Manifest sequence mismatch.")
            require(isinstance(page.get("articles"), list))
            articles.extend(page["articles"])
            require(len(articles) <= count)
            nxt = page.get("nextManifestUrl")
            if nxt is None:
                break
            require(nxt not in seen and page["articles"], "Manifest navigation loop.")
            seen.add(nxt)
            self.pinned(nxt, "/api/agent/latest", folder, snapshot, offset=len(articles))
            page = self.request("/api/agent/latest", navigation=nxt)
        else:
            raise FolioError("Manifest page budget exhausted; incomplete.")
        require(len(articles) == count)
        names = [basename(a.get("filename")) for a in articles]
        require(len(set(names)) == count, "Duplicate manifest filename.")
        own = set()
        if expected_status is not None:
            require(expected_status.get("status") in {"completed", "partial", "error"}, "Job is not terminal.")
            call_id = expected_status.get("callId")
            require(call_id and any(c.get("callId") == call_id for c in first.get("collections", [])),
                    "Latest folder does not contain the requested job; refusing older fallback.")
            for item in expected_status.get("results", []):
                if item.get("status") == "saved":
                    saved = item.get("savedFile", "")
                    require(isinstance(saved, str) and "\\" not in saved)
                    parts = saved.split("/")
                    require(len(parts) >= 2 and parts[-2] == folder, "Saved file belongs to another folder.")
                    own.add(basename(parts[-1]))
            require(own and own <= set(names), "Job's saved files are missing from latest.")
        destination = None
        if output_dir is not None:
            destination = Path(output_dir)
            require(destination.is_absolute(), "Use an explicit absolute output directory.")
            destination.mkdir(mode=0o700, parents=False, exist_ok=False)
        ledger = {"folder": folder, "snapshotId": snapshot, "expectedArticleCount": count,
                  "verifiedCount": 0, "complete": False, "collections": first.get("collections", []),
                  "warnings": first.get("warnings", []), "articles": []}
        total_download = 0
        for article in articles:
            name = basename(article.get("filename"))
            chars, size, digest = article.get("characters"), article.get("bytes"), article.get("sha256")
            require(integer(chars, 0, 20_000_000) and integer(size, 0, 80_000_000)
                    and isinstance(digest, str) and HEX.fullmatch(digest)
                    and type(article.get("partial")) is bool, "Invalid article integrity metadata.")
            require(total_download + size <= 100 * 1024 * 1024, "Snapshot exceeds 100 MB local budget.")
            nxt, offset, chunks, visited = article.get("readUrl"), 0, [], set()
            for _ in range(10000):
                self.pinned(nxt, "/api/agent/read", folder, snapshot, name, offset)
                require(nxt not in visited, "Article navigation loop.")
                visited.add(nxt)
                chunk = self.request("/api/agent/read", navigation=nxt)
                require((chunk.get("folder"), chunk.get("snapshotId"), chunk.get("filename")) == (folder, snapshot, name))
                require((chunk.get("totalCharacters"), chunk.get("totalBytes"), chunk.get("sha256")) == (chars, size, digest))
                require(chunk.get("partial") is article["partial"], "Article partial flag changed.")
                text = chunk.get("text")
                require(isinstance(text, str) and chunk.get("offset") == offset)
                require(chunk.get("chunkCharacters") == len(text) and chunk.get("nextOffset") == offset + len(text))
                offset += len(text)
                require(offset <= chars)
                chunks.append(text)
                if chunk.get("endOfArticle") is True:
                    require(chunk.get("nextUrl") is None and offset == chars, "Invalid end marker.")
                    break
                require(chunk.get("endOfArticle") is False and text and chunk.get("nextUrl"), "Missing end marker.")
                nxt = chunk["nextUrl"]
            else:
                raise FolioError("Article chunk budget exhausted; incomplete.")
            content = "".join(chunks)
            require(self.scrub(content) == content and self.scrub(name) == name,
                    "Article contains credential-like data; refusing to persist it.")
            encoded = content.encode("utf-8")
            require(len(encoded) == size and hashlib.sha256(encoded).hexdigest() == digest,
                    "Article checksum or byte count mismatch; incomplete.")
            total_download += size
            if destination:
                with (destination / name).open("xb") as handle:
                    handle.write(encoded)
            ledger["articles"].append({"filename": name, "characters": chars, "bytes": size,
                                       "sha256": digest, "partial": article.get("partial"),
                                       "selectedJobFile": name in own, "verified": True})
            ledger["verifiedCount"] += 1
        ledger["complete"] = True
        safe_ledger = self.scrub(ledger)
        if destination:
            with (destination / "verification-ledger.json").open("x", encoding="utf-8") as handle:
                json.dump(safe_ledger, handle, ensure_ascii=False, indent=2)
        return safe_ledger


def load_json(filename):
    with open(filename, "rb") as handle:
        raw = handle.read(MAX_RESPONSE + 1)
    require(len(raw) <= MAX_RESPONSE, "Input JSON exceeds 5 MB.")
    value = json.loads(raw.decode("utf-8"))
    require(isinstance(value, dict), "Input must be a JSON object.")
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    catalog = commands.add_parser("catalog", help="Discover catalog labels, not article text")
    catalog.add_argument("--keyword", action="append", default=[])
    catalog.add_argument("--publisher", action="append", default=[])
    catalog.add_argument("--limit", type=int, default=25)
    catalog.add_argument("--next-url", help="Credential-free nextUrl returned by catalog")
    commands.add_parser("fetch", help="Fetch at most 8 selected feeds once").add_argument("json_file")
    commands.add_parser("links", help="POST a daily ten-Main-feed report once")
    commands.add_parser("save", help="Submit a selected-article batch once").add_argument("json_file")
    commands.add_parser("status", help="One explicit status poll; space polls at least 5 seconds apart").add_argument("call_id")
    reading = commands.add_parser("read-latest", help="Verify pinned latest; print ledger, not article bodies")
    reading.add_argument("--output-dir", help="New absolute directory; never overwrite existing files")
    reading.add_argument("--status-file", help="Terminal status JSON of the newly saved job")
    args = parser.parse_args(argv)
    try:
        client = Client()
        if args.command == "catalog":
            result = client.catalog(args.keyword, args.publisher, args.limit, args.next_url)
        elif args.command == "fetch":
            result = client.fetch(load_json(args.json_file))
        elif args.command == "links":
            result = client.request("/api/links", "POST")
        elif args.command == "save":
            result = client.save(load_json(args.json_file))
        elif args.command == "status":
            result = client.status(args.call_id)
        else:
            expected = load_json(args.status_file) if args.status_file else None
            result = client.read_latest(args.output_dir, expected)
        print(json.dumps(client.scrub(result), ensure_ascii=False, indent=2))
        return 0
    except FolioError as exc:
        # All FolioError messages are local constants or numeric HTTP codes.
        print("Folio: " + str(exc), file=sys.stderr)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError):
        # Local filenames, remote JSON and unexpected shapes may contain secrets.
        print("Folio: invalid input/response or local file operation failed; incomplete. No automatic retry.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
