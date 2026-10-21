"""Pure mocked-network tests: no sockets, Folio service, packages or credentials."""
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse as url

import folio

ORIGIN = "https://folio.example"
KEY = "mock-only-sensitive-key/+"
VERSION = "a" * 64
SNAPSHOT = "b" * 64
FOLDER = "2026-10-21"
NAME = "story.md"


class Response:
    status = 200

    def __init__(self, value):
        self.raw = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size):
        return self.raw[:size]


class MockNetwork:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        if not self.responses:
            raise AssertionError("Unexpected request; tests must never use real networking")
        value = self.responses.pop(0)
        if isinstance(value, Exception):
            raise value
        return Response(value)


def client(*responses):
    network = MockNetwork(*responses)
    return folio.Client(ORIGIN, KEY, network), network


def navigation(path, **query):
    return path + "?" + url.urlencode(query)


def fixtures(text="A😀e\u0301\n", split=2):
    encoded = text.encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    read = navigation("/api/agent/read", folder=FOLDER, snapshot=SNAPSHOT, file=NAME)
    article = {"filename": NAME, "characters": len(text), "bytes": len(encoded),
               "sha256": digest, "partial": True, "readUrl": read}
    manifest = {"folder": FOLDER, "snapshotId": SNAPSHOT, "articleCount": 1,
                "manifestOffset": 0, "articles": [article], "nextManifestUrl": None,
                "collections": [{"callId": "job-123", "failed": 1}], "warnings": ["Partial extraction"]}
    chunks = []
    for start, end in [(0, split), (split, len(text))]:
        chunks.append({"folder": FOLDER, "snapshotId": SNAPSHOT, "filename": NAME,
                       "offset": start, "nextOffset": end, "text": text[start:end],
                       "chunkCharacters": end - start, "totalCharacters": len(text),
                       "totalBytes": len(encoded), "sha256": digest, "partial": True,
                       "endOfArticle": end == len(text),
                       "nextUrl": None if end == len(text) else navigation(
                           "/api/agent/read", folder=FOLDER, snapshot=SNAPSHOT, file=NAME, offset=end)})
    return manifest, chunks


class SecurityTests(unittest.TestCase):
    def test_origin_restrictions(self):
        for origin in ["http://localhost", "http://127.0.0.1", "https://user:pw@folio.example",
                       ORIGIN + "/path", ORIGIN + "?hash=no", ORIGIN + "#", ORIGIN + "?",
                       ORIGIN + "\\evil", "https://folio.example:bad", "https://@folio.example", ""]:
            with self.subTest(origin=origin), self.assertRaises(folio.FolioError):
                folio.Client(origin, KEY, MockNetwork())

    def test_missing_key(self):
        with self.assertRaises(folio.FolioError):
            folio.Client(ORIGIN, "", MockNetwork())

    def test_navigation_boundaries(self):
        c, _ = client()
        for value in ["https://evil.example/api/agent/read", "//evil.example/api/agent/read",
                      ORIGIN + ":444/api/agent/read", "/api/agent/read/", "/api/agent/%72ead",
                      "/api/collect", "/api/agent/read?hash=oops", "/api/agent/read#x",
                      "/api/agent/read?file=a&file=b", "/api/agent/read?unknown=x",
                      "https://user@folio.example/api/agent/read", "/api/agent/read\n"]:
            with self.subTest(value=value), self.assertRaises(folio.FolioError):
                c.safe_url(value, "/api/agent/read")
        self.assertEqual(c.safe_url("/api/agent/read?file=a", "/api/agent/read"),
                         ORIGIN + "/api/agent/read?file=a")

    def test_redirect_rejected_without_follow(self):
        with self.assertRaises(folio.FolioError):
            folio.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://evil.example")

    def test_query_auth_and_timeout(self):
        c, net = client({"ok": True})
        c.request("/api/links", "POST")
        req, timeout = net.requests[0]
        self.assertEqual(timeout, 180)
        self.assertEqual(url.parse_qs(url.urlsplit(req.full_url).query), {"hash": [KEY]})
        self.assertNotIn("Authorization", req.headers)
        self.assertEqual(req.method, "POST")

    def test_http_errors_never_echo(self):
        for code in [302, 400, 401, 409, 413, 429, 502]:
            error = urllib.error.HTTPError(ORIGIN + "?hash=" + KEY, code, KEY, {}, io.BytesIO(KEY.encode()))
            c, net = client(error)
            with self.assertRaises(folio.FolioError) as caught:
                c.request("/api/links", "POST")
            self.assertNotIn(KEY, str(caught.exception))
            self.assertNotIn(ORIGIN, str(caught.exception))
            self.assertEqual(len(net.requests), 1)

    def test_timeout_no_repeat(self):
        c, net = client(urllib.error.URLError(KEY))
        with self.assertRaises(folio.FolioError) as caught:
            c.request("/api/links", "POST")
        self.assertNotIn(KEY, str(caught.exception))
        self.assertEqual(len(net.requests), 1)

    def test_response_bound_and_invalid_json(self):
        for raw in [b"x" * (folio.MAX_RESPONSE + 1), b"not json", b"\xff", b"[]"]:
            c, _ = client(raw)
            with self.assertRaises(folio.FolioError):
                c.request("/api/links")

    def test_recursive_redaction(self):
        c, _ = client()
        result = json.dumps(c.scrub({"value": [KEY, url.quote_plus(KEY),
                                               "https://folio.example/?hash=other-secret&x=1"]}))
        self.assertNotIn(KEY, result)
        self.assertNotIn("other-secret", result)
        self.assertNotIn(url.quote_plus(KEY), result)


class CommandTests(unittest.TestCase):
    def test_literal_or_catalog_parameters(self):
        c, net = client({"schemaVersion": 1, "catalogVersion": VERSION, "nextUrl": None})
        c.catalog(["canada", "économy"], ["Financial Times"], 25)
        query = url.parse_qs(url.urlsplit(net.requests[0][0].full_url).query)
        self.assertEqual(query["q"], ["canada", "économy"])
        self.assertEqual(query["publisher"], ["Financial Times"])

    def test_catalog_input_bounds(self):
        for keywords, limit in [(["x"] * 13, 25), ([""], 25), (["x" * 81], 25), ([], 101), ([], 0)]:
            c, net = client()
            with self.assertRaises(folio.FolioError):
                c.catalog(keywords, limit=limit)
            self.assertFalse(net.requests)

    def test_catalog_next_and_full_enumeration(self):
        c, net = client({"schemaVersion": 1, "catalogVersion": VERSION, "nextUrl": None})
        c.catalog()
        self.assertNotIn("q", url.parse_qs(url.urlsplit(net.requests[0][0].full_url).query))
        c, _ = client()
        with self.assertRaises(folio.FolioError):
            c.catalog(["canada"], next_url="/api/feed-catalog?cursor=x")
        c, _ = client({"schemaVersion": 1, "catalogVersion": VERSION,
                       "nextUrl": "https://evil.example/api/feed-catalog"})
        with self.assertRaises(folio.FolioError):
            c.catalog()
        c, net = client()
        with self.assertRaises(folio.FolioError):
            c.catalog(next_url="/api/feed-catalog?limit=1000")
        self.assertFalse(net.requests)

    def test_fetch_validation(self):
        valid = {"catalogVersion": VERSION, "selections": [{"feedId": "feed_" + VERSION, "candidateLimit": 20}]}
        c, net = client({"partial": True, "feeds": [{"status": "fetch_failed"}]})
        self.assertTrue(c.fetch(valid)["partial"])
        self.assertEqual(json.loads(net.requests[0][0].data), valid)
        bad = [dict(valid, extra=True), dict(valid, catalogVersion="bad"), dict(valid, selections=[]),
               dict(valid, selections=valid["selections"] * 2),
               dict(valid, selections=[{"feedId": "feed_" + VERSION, "candidateLimit": True}]),
               dict(valid, selections=[{"feedId": "feed_" + VERSION, "candidateLimit": 21}]),
               dict(valid, selections=[{"feedId": "feed_" + str(i) * 64, "candidateLimit": 20} for i in range(6)])]
        for body in bad:
            c, net = client()
            with self.subTest(body=body), self.assertRaises(folio.FolioError):
                c.fetch(body)
            self.assertFalse(net.requests)

    def test_save_endpoint_and_single_submission(self):
        body = {"urls": [{"url": "https://publisher.example/article", "website": "Publisher", "section": "News"}], "format": "markdown"}
        c, net = client({"callId": "job-123", "statusEndpoint": "/api/save-batch/status?callId=job-123"})
        self.assertEqual(c.save(body)["callId"], "job-123")
        self.assertEqual(len(net.requests), 1)
        c, net = client({"callId": "job-123", "statusEndpoint": "/api/save-batch/status?callId=other"})
        with self.assertRaises(folio.FolioError):
            c.save(body)
        self.assertEqual(len(net.requests), 1)

    def test_save_bounds_and_credentials(self):
        for body in [{"urls": [], "format": "markdown"}, {"urls": [{}] * 101, "format": "markdown"},
                     {"urls": [{"url": "https://u:p@publisher.example/x"}], "format": "markdown"},
                     {"urls": [{"url": "file:///etc/passwd"}], "format": "markdown"}]:
            c, net = client()
            with self.assertRaises(folio.FolioError):
                c.save(body)
            self.assertFalse(net.requests)

    def test_one_status_poll(self):
        c, net = client({"callId": "job-123", "status": "in progress"})
        self.assertEqual(c.status("job-123")["status"], "in progress")
        self.assertEqual(len(net.requests), 1)

    def test_cli_sanitizes_local_and_environment_errors(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.dict("os.environ", {"FOLIO_ORIGIN": ORIGIN + "/" + KEY, "FOLIO_ACCESS_HASH": KEY}), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            self.assertEqual(folio.main(["links"]), 1)
        self.assertNotIn(KEY, stdout.getvalue() + stderr.getvalue())


class ReadingTests(unittest.TestCase):
    def test_unicode_exact_and_ledger(self):
        manifest, chunks = fixtures()
        c, net = client(manifest, *chunks)
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "new"
            ledger = c.read_latest(str(output))
            self.assertEqual((output / NAME).read_bytes(), "A😀e\u0301\n".encode())
            self.assertTrue(ledger["complete"])
            self.assertEqual(ledger["verifiedCount"], 1)
            self.assertTrue(ledger["articles"][0]["partial"])
            self.assertEqual(json.loads((output / "verification-ledger.json").read_text()), ledger)
        self.assertEqual(len(net.requests), 3)

    def test_job_binding_and_files(self):
        manifest, chunks = fixtures()
        expected = {"callId": "job-123", "status": "partial", "results": [
            {"status": "saved", "savedFile": f"output/articles/{FOLDER}/{NAME}"}]}
        c, _ = client(manifest, *chunks)
        self.assertTrue(c.read_latest(expected_status=expected)["articles"][0]["selectedJobFile"])
        for changed in [dict(expected, callId="other-job"), dict(expected, status="in progress"),
                        dict(expected, results=[]), dict(expected, results=[
                            {"status": "saved", "savedFile": "output/articles/older/story.md"}])]:
            c, net = client(manifest)
            with self.assertRaises(folio.FolioError):
                c.read_latest(expected_status=changed)
            self.assertEqual(len(net.requests), 1)

    def test_manifest_pagination(self):
        manifest, chunks = fixtures()
        first = copy.deepcopy(manifest)
        first["articleCount"] = 2
        first["nextManifestUrl"] = navigation("/api/agent/latest", folder=FOLDER, snapshot=SNAPSHOT, offset=1)
        second = copy.deepcopy(first)
        second["manifestOffset"] = 1
        second["nextManifestUrl"] = None
        second["articles"][0]["filename"] = "second.md"
        second["articles"][0]["readUrl"] = navigation("/api/agent/read", folder=FOLDER, snapshot=SNAPSHOT, file="second.md")
        second_chunks = copy.deepcopy(chunks)
        for chunk in second_chunks:
            chunk["filename"] = "second.md"
            if chunk["nextUrl"]:
                chunk["nextUrl"] = chunk["nextUrl"].replace("story.md", "second.md")
        c, _ = client(first, second, *chunks, *second_chunks)
        self.assertEqual(c.read_latest()["verifiedCount"], 2)

    def test_changed_snapshot_duplicate_and_missing_manifest(self):
        manifest, _ = fixtures()
        duplicate = copy.deepcopy(manifest)
        duplicate["articleCount"] = 2
        duplicate["articles"] *= 2
        missing = dict(manifest, articleCount=2)
        cross = dict(manifest, nextManifestUrl="https://evil.example/api/agent/latest")
        for value in [duplicate, missing, cross]:
            c, _ = client(value)
            with self.assertRaises(folio.FolioError):
                c.read_latest()

    def test_read_pin_checksum_offsets_and_end_marker(self):
        for field, value in [("snapshotId", "c" * 64), ("filename", "other.md"),
                             ("offset", 1), ("totalCharacters", 999), ("text", "XX"),
                             ("nextOffset", 999), ("endOfArticle", True),
                             ("nextUrl", "https://evil.example/api/agent/read")]:
            manifest, chunks = fixtures()
            chunks[0][field] = value
            c, _ = client(manifest, *chunks)
            with self.subTest(field=field), self.assertRaises(folio.FolioError):
                c.read_latest()
        manifest, chunks = fixtures()
        chunks[1]["text"] = "abc"  # same character count, different UTF-8/checksum
        c, _ = client(manifest, *chunks)
        with self.assertRaises(folio.FolioError):
            c.read_latest()

    def test_unsafe_filenames_and_no_overwrite(self):
        for name in ["../x", "..", ".hidden", "a/b", "a\\b", "a\x00b", "verification-ledger.json"]:
            manifest, _ = fixtures()
            manifest["articles"][0]["filename"] = name
            c, _ = client(manifest)
            with self.assertRaises(folio.FolioError):
                c.read_latest()
        manifest, _ = fixtures()
        c, _ = client(manifest)
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "keep"
            marker.write_text("preserved")
            with self.assertRaises(FileExistsError):
                c.read_latest(temporary)
            self.assertEqual(marker.read_text(), "preserved")

    def test_snapshot_409_not_restarted(self):
        manifest, _ = fixtures()
        error = urllib.error.HTTPError("secret-url", 409, KEY, {}, io.BytesIO())
        c, net = client(manifest, error)
        with self.assertRaises(folio.FolioError):
            c.read_latest()
        self.assertEqual(len(net.requests), 2)

    def test_secret_in_article_not_written(self):
        manifest, chunks = fixtures(text="content " + KEY, split=2)
        c, _ = client(manifest, *chunks)
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "new"
            with self.assertRaises(folio.FolioError):
                c.read_latest(str(output))
            self.assertFalse(list(output.iterdir()))


if __name__ == "__main__":
    unittest.main()
