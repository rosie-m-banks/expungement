"""
Local web UI wrapper for the expungement screening.

Run:
  python web_server.py

Then open:
  http://127.0.0.1:8000
"""

from __future__ import annotations

import json
import os
import posixpath
import threading
import time
import uuid
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from typing import Any
from urllib.parse import urlparse, parse_qs

from input_manager import InputManager
from output_manager import OutputManager
from petition_generator import (
    PetitionValidationError,
    generate_petition_pdf,
    petition_filename,
)
from petition_prefill import build_petition_prefill
import screening


# ---------------------------------------------------------------------------
# Count classification (short-circuit AI checks)
# ---------------------------------------------------------------------------

def classify_count(input_manager: InputManager, count: str) -> str:
    """Run the short-circuit legal-statute classification for a single charge.

    Order of precedence:
      reclassified → none → 571 → 13-sora / sora → 571 (violent but not 13/SORA)
    """
    if input_manager.check_file_contents("legal_statutes/reclassified.txt", count):
        return "reclassified"
    if not input_manager.check_file_contents("legal_statutes/section571.txt", count):
        return "none"
    # Violent under 571 — check the two worst-case lists
    if input_manager.check_file_contents("legal_statutes/section13.txt", count):
        return "13-sora"
    if input_manager.check_file_contents("legal_statutes/SORA.txt", count):
        return "13-sora"
    return "571"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")

# The browser runs the screening itself and fetches these two directories
# directly. The GitHub Pages build copies them into web/ before publishing;
# when this process serves the site they stay where they are in the repository.
SHARED_ASSET_DIRS = frozenset({"questions", "legal_statutes"})


# ---------------------------------------------------------------------------
# Type decoding: raw string answers -> Python types
# ---------------------------------------------------------------------------

def decode_answers(questions: list[dict], raw_answers: list) -> list:
    """Convert raw frontend values into the Python types that gather_info
    expects, based on each question's ``response_type``."""
    decoded: list[Any] = []
    for q, raw in zip(questions, raw_answers):
        rtype = q["response_type"]
        if rtype == "Boolean":
            if isinstance(raw, bool):
                decoded.append(raw)
            else:
                decoded.append(str(raw).lower() in ("yes", "y", "true", "1"))
        elif rtype == "Int":
            decoded.append(int(raw))
        elif rtype == "Float":
            decoded.append(float(raw))
        elif rtype == "Date":
            decoded.append(datetime.strptime(str(raw), "%m-%d-%Y"))
        elif rtype == "DateList":
            if isinstance(raw, str):
                raw = raw.strip()
                if raw in ("", "[]"):
                    decoded.append([])
                else:
                    decoded.append([datetime.strptime(s.strip(), "%m-%d-%Y") for s in raw.split(",")])
            elif isinstance(raw, list):
                decoded.append([datetime.strptime(str(s), "%m-%d-%Y") for s in raw])
            else:
                decoded.append([])
        elif rtype == "DateStringPairList":
            # Each element is a [date_str, agency_str] pair from the frontend.
            if isinstance(raw, list):
                pairs = []
                for item in raw:
                    if isinstance(item, (list, tuple)) and len(item) == 2:
                        dt = datetime.strptime(str(item[0]), "%m-%d-%Y")
                        pairs.append((dt, str(item[1])))
                decoded.append(pairs)
            else:
                decoded.append([])
        elif rtype == "StringList":
            if isinstance(raw, str):
                raw = raw.strip()
                if raw in ("", "[]"):
                    decoded.append([])
                else:
                    decoded.append([s.strip() for s in raw.split(",") if s.strip()])
            elif isinstance(raw, list):
                decoded.append([s.strip() for s in raw])
            else:
                decoded.append([])
        elif rtype == "ClassifiedStringList":
            # Each element is a [count_name, classification] pair submitted by
            # the frontend after AI classification + optional manual override.
            if isinstance(raw, list):
                pairs = []
                for item in raw:
                    if isinstance(item, (list, tuple)) and len(item) == 2:
                        pairs.append((str(item[0]), str(item[1])))
                    else:
                        pairs.append((str(item), "none"))
                decoded.append(pairs)
            else:
                decoded.append([])
        else:  # String
            decoded.append(str(raw))
    return decoded


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

class Session:
    """Manages one screening run.

    Phase 1 (``start_gathering``): runs ``screening.gather()`` in a background
    thread.  The thread blocks inside ``InputManager.ask_questions()`` until
    the web API feeds decoded answers back.

    Phase 2 (``start_analysis``): triggered by the user clicking
    "Start Analysis".  Runs ``screening.analyze()`` in a second background
    thread and collects results via ``OutputManager``.
    """

    def __init__(self) -> None:
        self.id: str = str(uuid.uuid4())
        self.input_manager = InputManager()
        self.output_manager = OutputManager()

        self.status: str = "collecting"  # collecting | data_collected | analyzing | done | error
        self.misdos: list | None = None
        self.felons: list | None = None
        self.arrests: list | None = None
        self.results: list | None = None
        self.error_message: str | None = None

        self._current_questions: list[dict] | None = None
        self._current_filenames: list[str] | None = None
        self._lock = threading.Lock()

    # -- phase 1 --------------------------------------------------------

    def start_gathering(self) -> None:
        threading.Thread(target=self._gather_worker, daemon=True).start()

    def _gather_worker(self) -> None:
        try:
            misdos, felons, arrests = screening.gather(
                input_manager=self.input_manager,
                output_manager=self.output_manager,
            )
            with self._lock:
                self.misdos = misdos
                self.felons = felons   
                self.arrests = arrests
                self.status = "data_collected"
        except Exception as exc:
            import traceback
            traceback.print_exc()
            with self._lock:
                self.status = "error"
                self.error_message = str(exc)

    # -- phase 2 --------------------------------------------------------

    def start_analysis(self) -> bool:
        with self._lock:
            if self.status != "data_collected":
                return False
            self.status = "analyzing"
        threading.Thread(target=self._analyze_worker, daemon=True).start()
        return True

    def _analyze_worker(self) -> None:
        try:
            screening.analyze(self.misdos, self.felons, self.arrests, self.output_manager)
            results = self.output_manager.drain_results()
            with self._lock:
                self.results = results
                self.status = "done"
        except Exception as exc:
            import traceback
            traceback.print_exc()
            with self._lock:
                self.status = "error"
                self.error_message = str(exc)

    # -- question / answer helpers --------------------------------------

    def get_questions(self) -> dict | None:
        """Return ``{"questions": [...], "filenames": [...]}`` or *None*."""
        batch = self.input_manager.get_pending_questions()
        if batch is not None:
            self._current_questions = batch["questions"]
            self._current_filenames = batch["filenames"]
            return batch
        return None

    def submit_answers(self, raw_answers: list) -> bool:
        if self._current_questions is None:
            return False
        decoded = decode_answers(self._current_questions, raw_answers)
        self.input_manager.provide_answers(decoded)
        self._current_questions = None
        return True

    # -- accessors -------------------------------------------------------

    def get_status(self) -> str:
        with self._lock:
            return self.status

    def get_results(self) -> list | None:
        with self._lock:
            return self.results

    def get_error(self) -> str | None:
        with self._lock:
            return self.error_message


# ---------------------------------------------------------------------------
# Session store
# ---------------------------------------------------------------------------

SESSIONS: dict[str, Session] = {}
SESSIONS_LOCK = threading.Lock()


def create_session() -> Session:
    session = Session()
    with SESSIONS_LOCK:
        SESSIONS[session.id] = session
    return session


def get_session(session_id: str) -> Session | None:
    with SESSIONS_LOCK:
        return SESSIONS.get(session_id)


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def translate_path(self, path: str) -> str:
        """Serve web/, plus the shared question and statute directories.

        Normalising the URL first is what makes this safe: a traversal
        attempt such as /questions/../web_server.py collapses to
        /web_server.py, whose leading segment is no longer a shared asset
        directory, so it falls through and is resolved under web/ instead.
        """
        url_path = posixpath.normpath(urlparse(path).path)
        if url_path.lstrip("/").split("/", 1)[0] in SHARED_ASSET_DIRS:
            original = self.directory
            try:
                self.directory = BASE_DIR
                return super().translate_path(url_path)
            finally:
                self.directory = original
        return super().translate_path(path)

    def end_headers(self) -> None:
        """Keep API answers uncached, but let static files revalidate.

        The statute embeddings are several megabytes, so re-sending them on
        every screening is wasteful. The base handler already sends
        Last-Modified and answers If-Modified-Since with 304, which keeps the
        browser from using a stale file without re-downloading a fresh one.
        """
        if urlparse(self.path).path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    # -- routing ---------------------------------------------------------

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/questions":
            self._handle_get_questions(parsed)
            return
        if parsed.path == "/api/status":
            self._handle_get_status(parsed)
            return
        if parsed.path == "/api/results":
            self._handle_get_results(parsed)
            return
        if parsed.path == "/api/petition-prefill":
            self._handle_get_petition_prefill(parsed)
            return
        if parsed.path.startswith("/api/"):
            self.send_error(404, "Unknown API endpoint")
            return
        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/start":
            self._handle_start()
            return
        if parsed.path == "/api/answers":
            self._handle_answers()
            return
        if parsed.path == "/api/analyze":
            self._handle_analyze()
            return
        if parsed.path == "/api/classify_counts":
            self._handle_classify_counts()
            return
        if parsed.path == "/api/generate_petition":
            self._handle_generate_petition()
            return
        self.send_error(404, "Unknown API endpoint")

    # -- POST /api/start ------------------------------------------------

    def _handle_start(self) -> None:
        session = create_session()
        session.start_gathering()
        # Give the gather thread a moment to enqueue the first question batch
        time.sleep(0.3)
        batch = session.get_questions()
        payload: dict[str, Any] = {
            "session_id": session.id,
            "status": session.get_status(),
            "questions": None,
            "filenames": None,
        }
        if batch:
            payload["questions"] = batch["questions"]
            payload["filenames"] = batch["filenames"]
        self._send_json(payload)

    # -- GET /api/questions ---------------------------------------------

    def _handle_get_questions(self, parsed) -> None:
        session = self._session_from_qs(parsed)
        if session is None:
            return
        batch = session.get_questions()
        status = session.get_status()
        payload: dict[str, Any] = {
            "status": status,
            "questions": None,
            "filenames": None,
        }
        if batch:
            payload["questions"] = batch["questions"]
            payload["filenames"] = batch["filenames"]
        if session.get_error():
            payload["error"] = session.get_error()
        self._send_json(payload)

    # -- POST /api/answers ----------------------------------------------

    def _handle_answers(self) -> None:
        payload = self._read_json()
        if payload is None:
            return
        session_id = payload.get("session_id")
        answers = payload.get("answers")
        if not session_id or answers is None:
            self.send_error(400, "Missing session_id or answers")
            return
        session = get_session(session_id)
        if not session:
            self.send_error(404, "Session not found")
            return
        ok = session.submit_answers(answers)
        self._send_json({"ok": ok})

    # -- POST /api/analyze ----------------------------------------------

    def _handle_analyze(self) -> None:
        payload = self._read_json()
        if payload is None:
            return
        session_id = payload.get("session_id")
        if not session_id:
            self.send_error(400, "Missing session_id")
            return
        session = get_session(session_id)
        if not session:
            self.send_error(404, "Session not found")
            return
        ok = session.start_analysis()
        self._send_json({"ok": ok, "status": session.get_status()})

    # -- POST /api/classify_counts --------------------------------------

    def _handle_classify_counts(self) -> None:
        payload = self._read_json()
        if payload is None:
            return
        session_id = payload.get("session_id")
        counts = payload.get("counts")
        if not session_id or counts is None:
            self.send_error(400, "Missing session_id or counts")
            return
        session = get_session(session_id)
        if not session:
            self.send_error(404, "Session not found")
            return
        results = []
        for count in counts:
            cls = classify_count(session.input_manager, str(count))
            results.append({"count": count, "class": cls})
        self._send_json({"classifications": results})

    # -- POST /api/generate_petition -----------------------------------

    def _handle_generate_petition(self) -> None:
        """Validate form data and return a generated petition draft PDF.

        This endpoint is intentionally usable without a screening session so
        the petition workflow can be tested independently. The results page
        only surfaces it for cases marked eligible.
        """
        payload = self._read_json()
        if payload is None:
            return
        try:
            pdf_bytes, normalized = generate_petition_pdf(payload)
        except PetitionValidationError as exc:
            self._send_json({"error": "Please correct the highlighted petition fields.", "errors": exc.errors}, status=400)
            return
        except Exception as exc:
            import traceback
            traceback.print_exc()
            self._send_json({"error": f"Unable to generate petition: {exc}"}, status=500)
            return

        self._send_pdf(pdf_bytes, petition_filename(normalized["petitioner_name"]))

    # -- GET /api/status ------------------------------------------------

    def _handle_get_status(self, parsed) -> None:
        session = self._session_from_qs(parsed)
        if session is None:
            return
        payload: dict[str, Any] = {"status": session.get_status()}
        if session.get_error():
            payload["error"] = session.get_error()
        self._send_json(payload)

    # -- GET /api/results -----------------------------------------------

    def _handle_get_results(self, parsed) -> None:
        session = self._session_from_qs(parsed)
        if session is None:
            return
        results = session.get_results()
        # Serialise results: each item is either a dict (case results) or a
        # string (early-exit message).  Convert to a uniform structure.
        serialised: list[dict[str, Any]] = []
        if results:
            for item in results:
                if isinstance(item, dict):
                    serialised.append({"type": "cases", "data": item})
                else:
                    serialised.append({"type": "message", "data": str(item)})
        self._send_json({
            "status": session.get_status(),
            "results": serialised,
        })

    # -- GET /api/petition-prefill -------------------------------------

    def _handle_get_petition_prefill(self, parsed) -> None:
        session = self._session_from_qs(parsed)
        if session is None:
            return
        if session.get_status() != "done":
            self._send_json(
                {"error": "Screening analysis must be completed before importing petition matters."},
                status=409,
            )
            return
        prefill = build_petition_prefill(
            session.misdos,
            session.felons,
            session.arrests,
            session.get_results(),
        )
        self._send_json(prefill)

    # -- helpers --------------------------------------------------------

    def _session_from_qs(self, parsed) -> Session | None:
        params = parse_qs(parsed.query)
        session_id = params.get("session_id", [None])[0]
        if not session_id:
            self.send_error(400, "Missing session_id")
            return None
        session = get_session(session_id)
        if not session:
            self.send_error(404, "Session not found")
            return None
        return session

    def _read_json(self) -> dict | None:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        try:
            return json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return None

    def _send_json(self, payload: dict[str, Any], *, status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_pdf(self, data: bytes, filename: str) -> None:
        safe_filename = filename.replace('"', "")
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", f'attachment; filename="{safe_filename}"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


# ---------------------------------------------------------------------------
# Entry-point
# ---------------------------------------------------------------------------

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main() -> None:
    if not os.path.isdir(WEB_DIR):
        raise RuntimeError(f"Missing web directory at {WEB_DIR}")
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    server = ThreadedHTTPServer((host, port), AppHandler)
    print(f"Serving on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
