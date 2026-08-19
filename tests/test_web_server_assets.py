"""The browser runs the screening client-side, so the server has to hand it
the question and statute files.

The GitHub Pages build copies questions/ and legal_statutes/ into web/ before
publishing. Nothing did that when this process served the site, so those URLs
404'd and no screening could start.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

import web_server


@pytest.fixture(scope="module")
def base_url():
    server = ThreadingHTTPServer(("127.0.0.1", 0), web_server.AppHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def get(url: str):
    try:
        with urllib.request.urlopen(url) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)


@pytest.mark.parametrize(
    "path",
    [
        "/questions/prelim_questions.json",
        "/questions/case_questions.json",
        "/questions/shared_questions.json",
        "/questions/felony_questions.json",
        "/questions/misdo_questions.json",
        "/questions/arrest_questions.json",
    ],
)
def test_question_files_are_served(base_url, path):
    status, body, _ = get(base_url + path)
    assert status == 200, f"{path} returned {status}"
    parsed = json.loads(body)
    assert parsed, f"{path} was empty"


@pytest.mark.parametrize(
    "path",
    [
        "/legal_statutes/section571.txt",
        "/legal_statutes/section571_embed.txt",
        "/legal_statutes/section13_embed.txt",
        "/legal_statutes/SORA_embed.txt",
        "/legal_statutes/reclassified_embed.txt",
    ],
)
def test_statute_files_are_served(base_url, path):
    status, body, _ = get(base_url + path)
    assert status == 200, f"{path} returned {status}"
    assert body.strip(), f"{path} was empty"


def test_the_landing_page_still_comes_from_web(base_url):
    status, body, _ = get(base_url + "/")
    assert status == 200
    assert b"<html" in body.lower()


def test_shared_asset_routing_does_not_expose_the_source_tree(base_url):
    """The prefix maps onto the project root, so traversal must stay blocked."""
    for path in (
        "/questions/../web_server.py",
        "/questions/../../etc/passwd",
        "/legal_statutes/../petition_generator.py",
    ):
        status, body, _ = get(base_url + path)
        assert status == 404, f"{path} returned {status}"
        assert b"reportlab" not in body
        assert b"BASE_DIR" not in body


def test_api_responses_are_never_cached(base_url):
    status, _, headers = get(base_url + "/api/unknown-endpoint")
    assert status == 404
    assert "no-store" in headers.get("Cache-Control", "")


def test_large_statute_files_may_be_revalidated_rather_than_refetched(base_url):
    """8.5 MB of embeddings must not be re-sent on every screening."""
    path = "/legal_statutes/section571_embed.txt"
    status, _, headers = get(base_url + path)
    assert status == 200
    assert "no-store" not in headers.get("Cache-Control", "")
    last_modified = headers.get("Last-Modified")
    assert last_modified, "no Last-Modified, so the browser cannot revalidate"

    request = urllib.request.Request(
        base_url + path, headers={"If-Modified-Since": last_modified}
    )
    try:
        with urllib.request.urlopen(request) as response:
            assert response.status == 304, f"expected 304, got {response.status}"
    except urllib.error.HTTPError as exc:
        assert exc.code == 304, f"expected 304, got {exc.code}"
