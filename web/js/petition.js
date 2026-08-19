/* Petition generator form and PDF download. */

const petitionForm = document.getElementById("petition-form");
const mattersList = document.getElementById("matters-list");
const matterTemplate = document.getElementById("matter-template");
const addMatterButton = document.getElementById("add-matter-btn");
const representation = document.getElementById("representation");
const obaField = document.getElementById("oba-field");
const obaInput = document.getElementById("oba-number");
const petitionerName = document.getElementById("petitioner-name");
const signerName = document.getElementById("signer-name");
const generateButton = document.getElementById("generate-btn");
const generationStatus = document.getElementById("generation-status");
const screeningImportStatus = document.getElementById("screening-import-status");

const MATTER_TITLES = {
  regular: "Filed criminal case",
  no_file: "Arrest - no charges filed",
};

function setStatus(message, isError = false) {
  generationStatus.textContent = message || "";
  generationStatus.classList.toggle("is-error", isError);
}

function setControlValue(card, field, value) {
  if (value === undefined || value === null || value === "") return;
  const controls = [...card.querySelectorAll(`[data-field="${field}"]`)];
  const target = controls.find((control) => !control.disabled) || controls[0];
  if (target) target.value = value;
}

function assignDynamicLabels(card, index) {
  card.querySelectorAll(".field-group").forEach((group, groupIndex) => {
    const control = group.querySelector("input, select, textarea");
    const label = group.querySelector("label");
    if (!control || !label) return;
    const id = `matter-${index}-${control.dataset.field || groupIndex}`;
    control.id = id;
    label.htmlFor = id;
  });
}

function updateOtherBasis(card) {
  const select = card.querySelector('[data-field="eligibility_basis"]');
  const other = card.querySelector('[data-field="eligibility_basis_other"]');
  const noFileVisible = !card.querySelector('[data-section="no_file"]').classList.contains("hidden");
  const needsOther = noFileVisible && select.value === "";
  other.classList.toggle("hidden", !needsOther);
  other.disabled = !needsOther;
  other.required = needsOther;
}

function setResolutionSection(card, sectionName, active) {
  card.querySelectorAll(`[data-resolution-section="${sectionName}"]`).forEach((section) => {
    section.classList.toggle("hidden", !active);
    section.querySelectorAll("input, select, textarea").forEach((control) => {
      control.disabled = !active;
    });
  });
}

function updateResolutionFields(card) {
  const kind = card.querySelector('[data-field="kind"]').value;
  const regularSection = card.querySelector('[data-section="regular"]');
  const regularActive = kind === "regular" && !regularSection.classList.contains("hidden");
  const resolved = card.querySelector('[data-field="resolved"]').value;
  const governmentPardon = card.querySelector('[data-field="government_pardon"]').value;
  const caseResult = card.querySelector('[data-field="case_result"]').value;

  setResolutionSection(card, "pardon-question", regularActive && resolved === "yes");
  setResolutionSection(
    card,
    "pardon-details",
    regularActive && resolved === "yes" && governmentPardon === "yes"
  );
  setResolutionSection(
    card,
    "other-special",
    regularActive && resolved === "yes" && governmentPardon === "no"
  );
  setResolutionSection(card, "case-result", regularActive && resolved === "no");
  setResolutionSection(
    card,
    "dismissal",
    regularActive && resolved === "no" && caseResult === "dismissal"
  );
  setResolutionSection(
    card,
    "conviction",
    regularActive && resolved === "no" && caseResult === "conviction"
  );

  card.querySelector(".matter-title").textContent =
    regularActive && resolved === "yes" && governmentPardon === "yes"
      ? "Governor pardon"
      : MATTER_TITLES[kind];
}

function updateMatterType(card) {
  const kind = card.querySelector('[data-field="kind"]').value;
  card.querySelector(".matter-title").textContent = MATTER_TITLES[kind];

  card.querySelectorAll("[data-section]").forEach((section) => {
    const active = section.dataset.section === kind;
    section.classList.toggle("hidden", !active);
    section.querySelectorAll("input, select, textarea").forEach((control) => {
      control.disabled = !active;
    });
  });
  updateOtherBasis(card);
  updateResolutionFields(card);
}

function renumberMatters() {
  const cards = [...mattersList.querySelectorAll(".matter-card")];
  cards.forEach((card, index) => {
    card.dataset.index = String(index);
    card.querySelector(".matter-number").textContent = String(index + 1);
    assignDynamicLabels(card, index + 1);
    card.querySelectorAll(".dated-fact-row").forEach((row, factIndex) => {
      row.querySelector(".dated-fact-date").setAttribute(
        "aria-label",
        `Matter ${index + 1}, additional fact ${factIndex + 1} date`
      );
      row.querySelector(".dated-fact-info").setAttribute(
        "aria-label",
        `Matter ${index + 1}, additional fact ${factIndex + 1} information`
      );
    });
    const removeButton = card.querySelector(".remove-matter-btn");
    removeButton.classList.toggle("hidden", cards.length === 1);
  });
  addMatterButton.disabled = cards.length >= 12;
}

function updateDatedFactRow(row) {
  const dateInput = row.querySelector(".dated-fact-date");
  const infoInput = row.querySelector(".dated-fact-info");
  const hasPartialValue = Boolean(dateInput.value || infoInput.value.trim());
  dateInput.required = hasPartialValue;
  infoInput.required = hasPartialValue;
}

function addDatedFactRow(card, fact = {}) {
  const list = card.querySelector("[data-dated-facts-list]");
  const row = document.createElement("div");
  row.className = "dated-fact-row";

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "dated-fact-date";
  dateInput.value = fact.date || "";

  const infoInput = document.createElement("input");
  infoInput.type = "text";
  infoInput.className = "dated-fact-info";
  infoInput.placeholder = "Petitioner completed a required program";
  infoInput.value = fact.info || "";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-dated-fact-btn";
  removeButton.textContent = "Remove";
  removeButton.setAttribute("aria-label", "Remove additional dated fact");

  const recheck = () => updateDatedFactRow(row);
  dateInput.addEventListener("input", recheck);
  infoInput.addEventListener("input", recheck);
  removeButton.addEventListener("click", () => {
    if (list.querySelectorAll(".dated-fact-row").length === 1) {
      dateInput.value = "";
      infoInput.value = "";
      updateDatedFactRow(row);
    } else {
      row.remove();
    }
    renumberMatters();
  });

  row.append(dateInput, infoInput, removeButton);
  list.appendChild(row);
  updateDatedFactRow(row);
  renumberMatters();
}

function initializeDatedFacts(card, facts) {
  const importedFacts = Array.isArray(facts) ? facts : [];
  if (importedFacts.length) {
    importedFacts.forEach((fact) => addDatedFactRow(card, fact));
  } else {
    addDatedFactRow(card);
  }
  card.querySelector("[data-add-dated-fact]").addEventListener("click", () => {
    addDatedFactRow(card);
  });
}

function collectDatedFacts(card) {
  return [...card.querySelectorAll(".dated-fact-row")]
    .map((row) => ({
      date: row.querySelector(".dated-fact-date").value,
      info: row.querySelector(".dated-fact-info").value.trim(),
    }))
    .filter((fact) => fact.date && fact.info);
}

function createMatter(prefill = {}) {
  if (mattersList.children.length >= 12) return;
  const card = matterTemplate.content.firstElementChild.cloneNode(true);
  mattersList.appendChild(card);

  const kindSelect = card.querySelector('[data-field="kind"]');
  const pardonPrefill = prefill.kind === "pardon";
  const normalizedPrefill = {
    ...prefill,
    kind: pardonPrefill ? "regular" : (prefill.kind || "regular"),
    resolved: prefill.resolved || (pardonPrefill ? "yes" : ""),
    government_pardon: prefill.government_pardon || (pardonPrefill ? "yes" : ""),
  };
  kindSelect.value = normalizedPrefill.kind;
  updateMatterType(card);
  initializeDatedFacts(card, normalizedPrefill.additional_dated_facts);

  Object.entries(normalizedPrefill).forEach(([field, value]) => setControlValue(card, field, value));
  updateMatterType(card);

  if (prefill.source_type) {
    const note = card.querySelector("[data-import-note]");
    const sourceLabel = prefill.source_type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const extraNotes = Array.isArray(prefill.import_notes) ? prefill.import_notes : [];
    note.textContent = [
      `Imported from the screening ${sourceLabel}.`,
      ...extraNotes,
      "Complete the amber petition-only fields before generating the PDF.",
    ].join(" ");
    note.classList.remove("hidden");
    card.querySelectorAll("[required]:not(:disabled)").forEach((control) => {
      if (!control.value.trim()) control.classList.add("import-needed");
    });
  }

  kindSelect.addEventListener("change", () => updateMatterType(card));
  card.querySelector('[data-field="resolved"]').addEventListener("change", () => updateResolutionFields(card));
  card.querySelector('[data-field="government_pardon"]').addEventListener("change", () => updateResolutionFields(card));
  card.querySelector('[data-field="case_result"]').addEventListener("change", () => updateResolutionFields(card));
  card.querySelector('[data-field="eligibility_basis"]').addEventListener("change", () => updateOtherBasis(card));
  card.querySelector(".remove-matter-btn").addEventListener("click", () => {
    card.remove();
    renumberMatters();
  });

  renumberMatters();
}

function updateRepresentation() {
  const represented = representation.value === "counsel";
  obaField.classList.toggle("hidden", !represented);
  obaInput.disabled = !represented;
  obaInput.required = represented;
  if (!represented && !signerName.value.trim()) {
    signerName.value = petitionerName.value;
  }
}

function isoDate(value) {
  const match = String(value || "").match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : value || "";
}

function parseDetails(details) {
  const parsed = {};
  String(details || "").split("\n").forEach((line) => {
    const colon = line.indexOf(":");
    if (colon === -1) return;
    parsed[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  });
  return parsed;
}

function prefillFromResults() {
  const raw = sessionStorage.getItem("petition_prefill");
  if (!raw) return null;
  sessionStorage.removeItem("petition_prefill");
  try {
    const stored = JSON.parse(raw);
    const details = parseDetails(stored.details);
    const court = details.Court || "";
    const countyMatch = court.match(/([A-Za-z ]+?)\s+County/i);
    const charges = (details.Charges || "")
      .split(/,\s*(?=[^,]+(?:\[[^\]]+\])?$)/)
      .map((charge) => charge.replace(/\s*\[[^\]]+\]\s*$/, "").trim())
      .filter(Boolean)
      .join("\n");
    return {
      kind: court ? "regular" : "no_file",
      county: countyMatch ? countyMatch[1].trim() : "",
      criminal_case_number: stored.caseName || "",
      court_name: court,
      arrest_date: isoDate(details["Arrest date"]),
      arresting_agency: details["Arresting agency"] || "",
      offenses: charges,
    };
  } catch (_error) {
    return null;
  }
}

function showImportStatus(message, tone = "success") {
  screeningImportStatus.textContent = message || "";
  screeningImportStatus.classList.toggle("hidden", !message);
  screeningImportStatus.dataset.tone = tone;
}

async function importScreeningMatters() {
  const sessionId = getSessionId();
  if (!sessionId) return false;

  showImportStatus("Importing eligible cases and arrests from screening...", "loading");
  try {
    const response = await fetch(
      `/api/petition-prefill?session_id=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error("The screening session is unavailable or analysis is incomplete.");
    }
    const data = await response.json();
    if (!Array.isArray(data.cases) || data.cases.length === 0) {
      showImportStatus(
        "No eligible screening matters were available to import. You can add a matter manually.",
        "warning"
      );
      return false;
    }

    mattersList.innerHTML = "";
    data.cases.forEach((matter) => createMatter(matter));
    const firstCounty = data.cases.find((matter) => matter.county)?.county;
    const filingCounty = document.getElementById("court-county");
    if (firstCounty && !filingCounty.value.trim()) filingCounty.value = firstCounty;

    const noun = data.eligible_count === 1 ? "matter" : "matters";
    showImportStatus(
      `Imported ${data.eligible_count} eligible ${noun} from the completed screening. ` +
        "Review the imported values and complete the amber petition-only fields.",
      "success"
    );
    return true;
  } catch (_error) {
    showImportStatus(
      "The completed screening could not be imported. You can continue with the available prefill or add matters manually.",
      "warning"
    );
    return false;
  }
}

function fieldValue(card, field) {
  const control = [...card.querySelectorAll(`[data-field="${field}"]`)].find((item) => !item.disabled);
  return control ? control.value.trim() : "";
}

function collectPayload() {
  const formData = new FormData(petitionForm);
  const payload = {
    court_county: formData.get("court_county"),
    civil_case_number: formData.get("civil_case_number"),
    petitioner_name: formData.get("petitioner_name"),
    dob: formData.get("dob"),
    representation: formData.get("representation"),
    signer_name: formData.get("signer_name"),
    oba_number: formData.get("oba_number") || "",
    organization: formData.get("organization"),
    street_address: formData.get("street_address"),
    city_state_zip: formData.get("city_state_zip"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    cases: [],
  };

  mattersList.querySelectorAll(".matter-card").forEach((card) => {
    const kind = fieldValue(card, "kind");
    const eligibilityBasis = fieldValue(card, "eligibility_basis") || fieldValue(card, "eligibility_basis_other");
    const item = {
      kind,
      county: fieldValue(card, "county"),
      arrest_date: fieldValue(card, "arrest_date"),
      arresting_agency: fieldValue(card, "arresting_agency"),
      offenses: fieldValue(card, "offenses"),
      additional_dated_facts: collectDatedFacts(card),
      category_number: fieldValue(card, "category_number"),
      statutory_language: fieldValue(card, "statutory_language"),
    };
    if (kind === "regular") {
      const resolved = fieldValue(card, "resolved");
      const governmentPardon = fieldValue(card, "government_pardon");
      item.criminal_case_number = fieldValue(card, "criminal_case_number");
      item.case_level = fieldValue(card, "case_level");

      if (resolved === "yes" && governmentPardon === "yes") {
        Object.assign(item, {
          kind: "pardon",
          doc_number: fieldValue(card, "doc_number"),
          pardon_date: fieldValue(card, "pardon_date"),
          exhibit_label: fieldValue(card, "exhibit_label"),
        });
      } else {
        Object.assign(item, {
          court_name: fieldValue(card, "court_name"),
          event_type: fieldValue(card, "event_type"),
          additional_facts: fieldValue(card, "additional_facts"),
        });
        if (resolved === "no") {
          const caseResult = fieldValue(card, "case_result");
          item.disposition_type = caseResult;
          if (caseResult === "dismissal") {
            item.dismissal_date = fieldValue(card, "dismissal_date");
            item.dismissal_reason = fieldValue(card, "dismissal_reason");
          } else if (caseResult === "conviction") {
            item.conviction_date = fieldValue(card, "conviction_date");
            item.conviction_method = fieldValue(card, "conviction_method");
            item.sentence_description = fieldValue(card, "sentence_description");
            item.sentence_completion_date = fieldValue(card, "sentence_completion_date");
          }
        } else {
          item.disposition_type = "other";
          item.disposition_date = fieldValue(card, "disposition_date");
          item.disposition = fieldValue(card, "disposition");
        }
      }
    } else {
      Object.assign(item, {
        verification_date: fieldValue(card, "verification_date"),
        verified_by: fieldValue(card, "verified_by"),
        prosecuting_agency: fieldValue(card, "prosecuting_agency"),
        record_agency: fieldValue(card, "record_agency"),
        eligibility_basis: eligibilityBasis,
      });
    }
    payload.cases.push(item);
  });
  return payload;
}

function showValidationErrors() {
  petitionForm.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  const invalid = [...petitionForm.querySelectorAll(":invalid")].filter((el) => !el.disabled);
  invalid.forEach((el) => el.classList.add("invalid"));
  if (invalid.length) {
    invalid[0].scrollIntoView({ behavior: "smooth", block: "center" });
    invalid[0].focus({ preventScroll: true });
    invalid[0].reportValidity();
    showError("Please complete the required fields before generating the petition.");
    return false;
  }
  showError("");
  return true;
}

/* A Response body is a one-shot stream, and reading it as JSON consumes it
 * even when the parse fails. So read it once as text and parse that, rather
 * than calling .json() and then .text() on the same response. */
async function errorMessageFromResponse(response, fallback) {
  let body = "";
  try {
    body = await response.text();
  } catch (_error) {
    return fallback;
  }

  try {
    const data = JSON.parse(body);
    const fromJson = data.errors?.join(" ") || data.error;
    if (fromJson) return fromJson;
  } catch (_error) {
    /* Not JSON. Fall through to the plain-text handling below. */
  }

  /* A static copy of the site has no /api route and answers with the host's
   * own HTML 404 page. Showing that markup to an attorney is worse than
   * useless, so say what actually went wrong. */
  if (response.status === 404 || /<\s*(!doctype|html)/i.test(body)) {
    return "The petition generator needs the screening server, which this page cannot reach.";
  }

  const text = body.trim();
  if (text && text.length <= 160 && !text.includes("<")) return text;
  return `${fallback} The server returned status ${response.status}.`;
}

function filenameFromResponse(response) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : "Petition_to_Expunge_DRAFT.pdf";
}

async function submitPetition(event) {
  event.preventDefault();
  if (!showValidationErrors()) return;

  generateButton.disabled = true;
  generateButton.querySelector(".button-label").textContent = "Generating PDF...";
  setStatus("Building the petition draft...");

  try {
    const response = await fetch("/api/generate_petition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectPayload()),
    });
    if (!response.ok) {
      throw new Error(
        await errorMessageFromResponse(response, "Unable to generate the petition.")
      );
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filenameFromResponse(response);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus("Draft PDF generated. Review every page before filing.");
  } catch (error) {
    setStatus(String(error.message || error), true);
    showError(String(error.message || error));
  } finally {
    generateButton.disabled = false;
    generateButton.querySelector(".button-label").textContent = "Generate draft PDF";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const legacyPrefill = prefillFromResults();
  updateRepresentation();

  addMatterButton.addEventListener("click", () => createMatter());
  representation.addEventListener("change", updateRepresentation);
  petitionerName.addEventListener("input", () => {
    if (representation.value === "pro_se" && !signerName.dataset.manuallyEdited) {
      signerName.value = petitionerName.value;
    }
  });
  signerName.addEventListener("input", () => {
    signerName.dataset.manuallyEdited = "true";
  });
  petitionForm.addEventListener("input", (event) => {
    event.target.classList.remove("invalid", "import-needed");
  });
  petitionForm.addEventListener("submit", submitPetition);

  const imported = await importScreeningMatters();
  if (!imported) createMatter(legacyPrefill || {});
});
