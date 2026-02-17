/* ------------------------------------------------------------------ */
/*  Session helpers                                                    */
/* ------------------------------------------------------------------ */
const SESSION_KEY = "expungement_session_id";

function getSessionId() {
  return sessionStorage.getItem(SESSION_KEY);
}

function setSessionId(id) {
  sessionStorage.setItem(SESSION_KEY, id);
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem("current_questions");
  sessionStorage.removeItem("current_filenames");
}

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Error display                                                      */
/* ------------------------------------------------------------------ */

function showError(msg) {
  const el = document.getElementById("error-text");
  if (el) el.textContent = msg || "";
}

/* ------------------------------------------------------------------ */
/*  Page navigation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Map source filenames to the correct page.
 */
function getNextPage(filenames) {
  if (!filenames || filenames.length === 0) return null;
  const joined = filenames.join(",");
  if (joined.includes("prelim_questions")) return "prelim.html";
  if (joined.includes("case_questions")) return "case-type.html";
  if (joined.includes("arrest_questions")) return "arrest.html";
  if (joined.includes("misdo_questions")) return "misdo.html";
  if (joined.includes("felony_questions")) return "felony.html";
  return null;
}

/**
 * Store a question batch in sessionStorage, then navigate to the
 * appropriate page.
 */
function storeAndNavigate(questions, filenames) {
  sessionStorage.setItem("current_questions", JSON.stringify(questions));
  sessionStorage.setItem("current_filenames", JSON.stringify(filenames));
  const page = getNextPage(filenames);
  if (page) {
    window.location.href = page;
  }
}

/**
 * Poll for the next question batch. When it arrives store it and
 * navigate; if data collection is finished go to the results page.
 */
async function pollAndNavigate() {
  const sessionId = getSessionId();
  if (!sessionId) {
    window.location.href = "index.html";
    return;
  }
  try {
    const data = await getJson(`/api/questions?session_id=${sessionId}`);
    if (data.questions) {
      storeAndNavigate(data.questions, data.filenames);
    } else if (data.status === "data_collected") {
      window.location.href = "results.html";
    } else if (data.status === "error") {
      showError(data.error || "An error occurred.");
    } else {
      setTimeout(pollAndNavigate, 500);
    }
  } catch (err) {
    showError(String(err));
  }
}


