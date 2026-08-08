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
  showSection(analyzingSection);
  try {
    const results = await engine.analyze();
    displayResults(results);
  } catch (err) {
    showError(String(err));
    showSection(readySection);
  }
}


/* ------------------------------------------------------------------ */
/*  Linked-text helper: parse <text, url> into anchors                 */
/* ------------------------------------------------------------------ */

function renderLinkedText(text, parent) {
  text.split(/(<[^>]+>)/).forEach((seg) => {
    const m = seg.match(/^<(.+?),\s*(https?:\/\/\S+?)>$/);
    if (m) {
      const a = document.createElement("a");
      a.textContent = m[1];
      a.href = m[2];
      a.target = "_blank";
      parent.appendChild(a);
    } else {
      parent.appendChild(document.createTextNode(seg));
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Export results as JSON                                             */
/* ------------------------------------------------------------------ */

let _lastResults = null;

function exportResults() {
  if (!_lastResults) return;

  // Merge all case dicts; skip non-case messages
  const cases = {};
  for (const item of _lastResults) {
    if (item.type !== "cases") continue;
    for (const [caseName, value] of Object.entries(item.data)) {
      const raw = typeof value === "object" ? value.verdict : value;
      const parts = raw.split("\n").map((s) => s.trim()).filter(Boolean);
      const entry = { verdict: parts[0] };
      if (parts.length > 1) entry.classes = parts.slice(1);

      // Carry over a details string if present — parse "Key: value" lines into an object
      if (typeof value === "object" && value.details) {
        const dparts = value.details.split("\n").map((s) => s.trim()).filter(Boolean);
        const detailsObj = {};
        for (const line of dparts) {
          const colon = line.indexOf(":");
          if (colon !== -1) {
            const k = line.slice(0, colon).trim();
            const v = line.slice(colon + 1).trim();
            detailsObj[k] = v;
          } else {
            detailsObj[line] = "";
          }
        }
        entry.details = detailsObj;
      }

      cases[caseName] = entry;
    }
  }

  const blob = new Blob([JSON.stringify({ cases }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "expungement_results.json";
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Display results                                                    */
/* ------------------------------------------------------------------ */

function displayResults(results) {
  _lastResults = results;
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
      for (const [caseName, value] of Object.entries(item.data)) {
        const card = document.createElement("div");
        card.className = "result-item";

        const nameEl = document.createElement("h3");
        nameEl.textContent = caseName;
        card.appendChild(nameEl);

        // value is either a string (legacy) or {verdict, details}
        const verdict = typeof value === "object" ? value.verdict : value;
        const details = typeof value === "object" ? value.details : null;

        const verdictEl = document.createElement("p");
        renderLinkedText(verdict, verdictEl);
        const lower = verdict.toLowerCase();
        verdictEl.className =
          lower.includes("expungeable") && !lower.includes("not expungeable")
            ? "eligible"
            : "ineligible";
        card.appendChild(verdictEl);

        if (details) {
          const detailsEl = document.createElement("pre");
          detailsEl.className = "case-details";
          renderLinkedText(details, detailsEl);
          card.appendChild(detailsEl);
        }

        resultsContainer.appendChild(card);
      }
    } else {
      const msg = document.createElement("div");
      msg.className = "result-message";
      renderLinkedText(item.data, msg);
      resultsContainer.appendChild(msg);
    }
  });

  showSection(resultsSection);
}

/* ------------------------------------------------------------------ */
/*  Event listeners                                                    */
/* ------------------------------------------------------------------ */

document.addEventListener("DOMContentLoaded", () => {
  if (!engine.hasState()) {
    window.location.href = "index.html";
    return;
  }

  document.getElementById("analyze-btn").addEventListener("click", startAnalysis);

  document.getElementById("export-btn").addEventListener("click", exportResults);

  document.getElementById("restart-btn").addEventListener("click", () => {
    clearSession();
    window.location.href = "index.html";
  });
});


