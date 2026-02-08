/* ------------------------------------------------------------------ */
/*  Results page logic                                                 */
/* ------------------------------------------------------------------ */

const readySection = document.getElementById("ready-section");
const analyzingSection = document.getElementById("analyzing-section");
const resultsSection = document.getElementById("results-section");
const resultsContainer = document.getElementById("results-container");

const ALL_SECTIONS = [readySection, analyzingSection, resultsSection];

function showSection(section) {
  ALL_SECTIONS.forEach((s) => s.classList.add("hidden"));
  section.classList.remove("hidden");
}

/* ------------------------------------------------------------------ */
/*  Start analysis                                                     */
/* ------------------------------------------------------------------ */

async function startAnalysis() {
  showError("");
  try {
    await postJson("/api/analyze", { session_id: getSessionId() });
    showSection(analyzingSection);
    pollForResults();
  } catch (err) {
    showError(String(err));
  }
}

/* ------------------------------------------------------------------ */
/*  Poll for results                                                   */
/* ------------------------------------------------------------------ */

async function pollForResults() {
  const sessionId = getSessionId();
  if (!sessionId) {
    window.location.href = "index.html";
    return;
  }
  try {
    const data = await getJson(`/api/status?session_id=${sessionId}`);
    if (data.status === "done") {
      const resultData = await getJson(
        `/api/results?session_id=${sessionId}`
      );
      displayResults(resultData.results);
    } else if (data.status === "error") {
      showError(data.error || "An error occurred during analysis.");
      showSection(readySection);
    } else {
      setTimeout(pollForResults, 500);
    }
  } catch (err) {
    showError(String(err));
    showSection(readySection);
  }
}

/* ------------------------------------------------------------------ */
/*  Display results                                                    */
/* ------------------------------------------------------------------ */

function displayResults(results) {
  resultsContainer.innerHTML = "";

  if (!results || results.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No results available.";
    resultsContainer.appendChild(p);
    showSection(resultsSection);
    return;
  }

  results.forEach((item) => {
    if (item.type === "cases") {
      for (const [caseName, verdict] of Object.entries(item.data)) {
        const card = document.createElement("div");
        card.className = "result-item";

        const nameEl = document.createElement("h3");
        nameEl.textContent = caseName;
        card.appendChild(nameEl);

        const verdictEl = document.createElement("p");
        verdictEl.textContent = verdict;
        const lower = verdict.toLowerCase();
        verdictEl.className =
          lower.includes("expungeable") && !lower.includes("not expungeable")
            ? "eligible"
            : "ineligible";
        card.appendChild(verdictEl);

        resultsContainer.appendChild(card);
      }
    } else {
      const msg = document.createElement("div");
      msg.className = "result-message";
      msg.textContent = item.data;
      resultsContainer.appendChild(msg);
    }
  });

  showSection(resultsSection);
}

/* ------------------------------------------------------------------ */
/*  Event listeners                                                    */
/* ------------------------------------------------------------------ */

document.addEventListener("DOMContentLoaded", () => {
  const sessionId = getSessionId();
  if (!sessionId) {
    window.location.href = "index.html";
    return;
  }

  document.getElementById("analyze-btn").addEventListener("click", startAnalysis);

  document.getElementById("restart-btn").addEventListener("click", () => {
    clearSession();
    window.location.href = "index.html";
  });
});

