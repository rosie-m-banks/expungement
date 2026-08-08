/* ------------------------------------------------------------------ */
/*  Shared question-page logic                                         */
/*                                                                     */
/*  Every question page (prelim, case-type, misdo, felony) includes    */
/*  common.js first, then this file.  On DOMContentLoaded it reads     */
/*  questions from sessionStorage, renders the form, and wires up the  */
/*  submit button.                                                     */
/* ------------------------------------------------------------------ */

document.addEventListener("DOMContentLoaded", () => {
  const raw = sessionStorage.getItem("current_questions");
  if (!raw) {
    window.location.href = "index.html";
    return;
  }

  const questions = JSON.parse(raw);
  renderQuestions(questions);

  const submitBtn = document.getElementById("submit-answers-btn");
  if (submitBtn) {
    submitBtn.addEventListener("click", () => submitAndNavigate(questions));
  }

  const restartBtn = document.getElementById("restart-btn");
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      clearSession();
      window.location.href = "index.html";
    });
  }
});

/* ------------------------------------------------------------------ */
/*  Note / link helper                                                 */
/* ------------------------------------------------------------------ */

function renderNote(text, links) {
  const p = document.createElement("p");
  p.className = "question-note";
  let li = 0;
  text.split(/(<[^>]+>)/).forEach((seg) => {
    if (seg.startsWith("<") && seg.endsWith(">")) {
      const a = document.createElement("a");
      a.textContent = seg.slice(1, -1);
      a.href = (links && links[li]) || "#";
      a.target = "_blank";
      li++;
      p.appendChild(a);
    } else {
      p.appendChild(document.createTextNode(seg));
    }
  });
  return p;
}

/* ------------------------------------------------------------------ */
/*  Dependency visibility                                              */
/* ------------------------------------------------------------------ */

function recheckDependencies(form) {
  form.querySelectorAll("[data-dep-idx]").forEach((group) => {
    const el = document.getElementById(`q-${group.dataset.depIdx}`);
    group.style.display = el && el.value === group.dataset.depVal ? "" : "none";
  });
}

/* ------------------------------------------------------------------ */
/*  Dynamic-list helpers (DateList, etc.)                              */
/* ------------------------------------------------------------------ */

/* ---- ClassifiedStringList helpers ---- */

const CLASSIFICATION_OPTIONS = [
  ["",             "Unclassified"],
  ["none",         "None"],
  ["reclassified", "Reclassified"],
  ["571",          "\u00a7571 Violent"],
  ["13-sora",      "\u00a713 / SORA"],
];

function updateSelectStyle(sel) {
  sel.className = "classification-select";
  const cls = sel.value || "unclassified";
  sel.classList.add(`cls-${cls}`);
}

function addClassifiedListItem(list) {
  const row = document.createElement("div");
  row.className = "dynamic-list-row classified-row";

  const inp = document.createElement("input");
  inp.type = "text";
  inp.placeholder = "Enter charge (e.g. Murder in the First Degree)";

  const sel = document.createElement("select");
  CLASSIFICATION_OPTIONS.forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    sel.appendChild(opt);
  });
  updateSelectStyle(sel);
  sel.addEventListener("change", () => updateSelectStyle(sel));

  const rm = document.createElement("button");
  rm.type = "button";
  rm.textContent = "\u00d7";
  rm.className = "remove-btn";
  rm.addEventListener("click", () => {
    if (list.querySelectorAll(".classified-row").length > 1) row.remove();
  });

  row.append(inp, sel, rm);
  list.appendChild(row);
}

function createClassifiedList(parent, id) {
  const list = document.createElement("div");
  list.className = "dynamic-list";
  list.id = id;
  addClassifiedListItem(list);

  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "+ Add charge";
  add.className = "add-list-btn";
  add.addEventListener("click", () => addClassifiedListItem(list));

  const classifyBtn = document.createElement("button");
  classifyBtn.type = "button";
  classifyBtn.textContent = "Classify Charges";
  classifyBtn.className = "classify-btn";
  classifyBtn.addEventListener("click", () => classifyCharges(list, classifyBtn));

  const btnRow = document.createElement("div");
  btnRow.className = "classified-btn-row";
  btnRow.append(add, classifyBtn);

  parent.append(list, btnRow);
}

async function classifyCharges(list, btn) {
  const counts = [...list.querySelectorAll(".classified-row")]
    .map((row) => row.querySelector("input[type=text]").value.trim())
    .filter(Boolean);

  if (!counts.length) {
    showError("Please enter at least one charge before classifying.");
    return;
  }
  showError("");

  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Classifying\u2026";

  try {
    const resp = await engine.classifyCounts(counts);

    // Build a map from count name → class
    const clsMap = {};
    (resp.classifications || []).forEach(({ count, class: cls }) => {
      clsMap[count] = cls;
    });

    // Update each row's dropdown — user can still override
    list.querySelectorAll(".classified-row").forEach((row) => {
      const name = row.querySelector("input[type=text]").value.trim();
      const sel = row.querySelector("select");
      if (name && clsMap[name] !== undefined) {
        sel.value = clsMap[name];
        updateSelectStyle(sel);
      }
    });

    btn.textContent = "Re-classify";
  } catch (err) {
    showError("Classification failed: " + String(err));
    btn.textContent = "Classify Charges";
  } finally {
    btn.disabled = false;
  }
}

function addListItem(list, type, placeholder) {
  const row = document.createElement("div");
  row.className = "dynamic-list-row";
  const inp = document.createElement("input");
  inp.type = type;
  if (placeholder) inp.placeholder = placeholder;
  const rm = document.createElement("button");
  rm.type = "button";
  rm.textContent = "\u00d7";
  rm.className = "remove-btn";
  rm.addEventListener("click", () => {
    if (list.querySelectorAll(".dynamic-list-row").length > 1) row.remove();
  });
  row.append(inp, rm);
  list.appendChild(row);
}

function createDynamicList(parent, id, type, placeholder, addLabel) {
  const list = document.createElement("div");
  list.className = "dynamic-list";
  list.id = id;
  addListItem(list, type, placeholder);
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = addLabel || "+ Add";
  add.className = "add-list-btn";
  add.addEventListener("click", () => addListItem(list, type, placeholder));
  parent.append(list, add);
}

/* ---- DateStringPairList helpers ---- */

function addDateStringPairItem(list) {
  const row = document.createElement("div");
  row.className = "dynamic-list-row pair-row";

  const dateInp = document.createElement("input");
  dateInp.type = "date";
  dateInp.className = "pair-date";

  const textInp = document.createElement("input");
  textInp.type = "text";
  textInp.className = "pair-text";
  textInp.placeholder = "Arresting agency";

  const rm = document.createElement("button");
  rm.type = "button";
  rm.textContent = "\u00d7";
  rm.className = "remove-btn";
  rm.addEventListener("click", () => {
    if (list.querySelectorAll(".pair-row").length > 1) row.remove();
  });

  row.append(dateInp, textInp, rm);
  list.appendChild(row);
}

function createDateStringPairList(parent, id) {
  const list = document.createElement("div");
  list.className = "dynamic-list";
  list.id = id;
  addDateStringPairItem(list);

  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "+ Add entry";
  add.className = "add-list-btn";
  add.addEventListener("click", () => addDateStringPairItem(list));

  parent.append(list, add);
}

/* ------------------------------------------------------------------ */
/*  Render                                                             */
/* ------------------------------------------------------------------ */

function renderQuestions(questions) {
  const form = document.getElementById("questions-form");
  if (!form) return;
  form.innerHTML = "";

  questions.forEach((q, i) => {
    const group = document.createElement("div");
    group.className = "question-group";

    const label = document.createElement("label");
    label.setAttribute("for", `q-${i}`);

    if (q.question.includes("\n")) {
      const parts = q.question.split("\n").filter((l) => l.trim());
      label.textContent = parts[0];
      group.appendChild(label);
      if (parts.length > 1) {
        const ul = document.createElement("ul");
        ul.className = "question-bullets";
        parts.slice(1).forEach((line) => {
          const li = document.createElement("li");
          li.textContent = line.trim();
          ul.appendChild(li);
        });
        group.appendChild(ul);
      }
    } else {
      label.textContent = q.question;
      group.appendChild(label);
    }

    const rtype = q.response_type;

    if (rtype === "Boolean") {
      const wrapper = document.createElement("div");
      wrapper.className = "yesno-group";

      const yesBtn = document.createElement("button");
      yesBtn.type = "button";
      yesBtn.textContent = "Yes";
      yesBtn.className = "yesno-btn yes-btn";

      const noBtn = document.createElement("button");
      noBtn.type = "button";
      noBtn.textContent = "No";
      noBtn.className = "yesno-btn no-btn";

      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.id = `q-${i}`;
      hidden.name = `q-${i}`;

      yesBtn.addEventListener("click", () => {
        hidden.value = "yes";
        yesBtn.classList.add("selected");
        noBtn.classList.remove("selected");
      });
      noBtn.addEventListener("click", () => {
        hidden.value = "no";
        noBtn.classList.add("selected");
        yesBtn.classList.remove("selected");
      });

      wrapper.appendChild(yesBtn);
      wrapper.appendChild(noBtn);
      wrapper.appendChild(hidden);
      group.appendChild(wrapper);
    } else if (rtype === "Int" && q.options) {
      let opts = q.options;
      if (typeof opts === "string") {
        opts = opts.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim());
      }
      const select = document.createElement("select");
      select.id = `q-${i}`;
      select.name = `q-${i}`;
      opts.forEach((opt, idx) => {
        const option = document.createElement("option");
        option.value = idx;
        option.textContent = opt;
        select.appendChild(option);
      });
      group.appendChild(select);
    } else if (rtype === "Int") {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "1";
      input.id = `q-${i}`;
      input.name = `q-${i}`;
      input.placeholder = "Enter a number";
      group.appendChild(input);
    } else if (rtype === "Float") {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.id = `q-${i}`;
      input.name = `q-${i}`;
      input.placeholder = "Enter an amount";
      group.appendChild(input);
    } else if (rtype === "Date") {
      const input = document.createElement("input");
      input.type = "date";
      input.id = `q-${i}`;
      input.name = `q-${i}`;
      group.appendChild(input);
    } else if (rtype === "DateList") {
      createDynamicList(group, `q-${i}`, "date", "", "+ Add date");
    } else if (rtype === "DateStringPairList") {
      createDateStringPairList(group, `q-${i}`);
    } else if (rtype === "StringList") {
      createDynamicList(group, `q-${i}`, "text", "Enter item", "+ Add item");
    } else if (rtype === "ClassifiedStringList") {
      createClassifiedList(group, `q-${i}`);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.id = `q-${i}`;
      input.name = `q-${i}`;
      input.placeholder = "Your answer";
      group.appendChild(input);
    }

    /* note / links */
    if (q.note) group.appendChild(renderNote(q.note, q.link));

    /* dependency — hide until condition met */
    if (q.dependancy) {
      const [depIdx, depVal] = q.dependancy.split(",").map((s) => s.trim());
      group.dataset.depIdx = depIdx;
      group.dataset.depVal = depVal;
      group.style.display = "none";
    }

    form.appendChild(group);
  });

  /* live-recheck dependencies on any interaction */
  const recheck = () => setTimeout(() => recheckDependencies(form), 0);
  form.addEventListener("input", recheck);
  form.addEventListener("change", recheck);
  form.addEventListener("click", recheck);
}

/* ------------------------------------------------------------------ */
/*  Collect answers                                                    */
/* ------------------------------------------------------------------ */

function collectAnswers(questions) {
  const answers = [];
  const missing = [];
  const optional = (q) => q.optional === "True";
  const fallback = (q) => (q.default != null ? q.default : "");

  /* Clear previous highlights */
  document.querySelectorAll(".question-group.missing-field").forEach((g) =>
    g.classList.remove("missing-field")
  );

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const el = document.getElementById(`q-${i}`);
    if (!el) { missing.push(i); continue; }

    /* hidden by dependency → send default */
    const group = el.closest(".question-group");
    if (group && group.style.display === "none") {
      answers.push(fallback(q));
      continue;
    }

    let value = el.value;
    const rtype = q.response_type;
    let empty = false;

    if (rtype === "Boolean") {
      empty = !value;
    } else if (rtype === "Date") {
      empty = !value;
      if (!empty) {
        const [y, m, d] = value.split("-");
        value = `${m}-${d}-${y}`;
      }
    } else if (rtype === "Int" || rtype === "Float") {
      empty = value === "" || value === undefined;
    } else if (rtype === "DateList") {
      const dates = [...el.querySelectorAll("input[type=date]")]
        .map((inp) => inp.value)
        .filter(Boolean)
        .map((v) => { const [y, m, d] = v.split("-"); return `${m}-${d}-${y}`; });
      value = dates.length ? dates.join(",") : fallback(q);
    } else if (rtype === "DateStringPairList") {
      const pairs = [...el.querySelectorAll(".pair-row")]
        .map((row) => {
          const d = row.querySelector(".pair-date").value;
          const t = row.querySelector(".pair-text").value.trim();
          if (!d || !t) return null;
          const [y, m, dy] = d.split("-");
          return [`${m}-${dy}-${y}`, t];
        })
        .filter(Boolean);
      value = pairs.length ? pairs : fallback(q);
    } else if (rtype === "StringList") {
      const items = [...el.querySelectorAll("input[type=text]")]
        .map((inp) => inp.value.trim())
        .filter(Boolean);
      value = items.length ? items : fallback(q);
    } else if (rtype === "ClassifiedStringList") {
      let hasUnclassified = false;
      /* Clear previous per-select highlights */
      el.querySelectorAll(".classification-select.unclassified-highlight").forEach(
        (s) => s.classList.remove("unclassified-highlight")
      );
      const pairs = [...el.querySelectorAll(".classified-row")]
        .map((row) => {
          const name = row.querySelector("input[type=text]").value.trim();
          const sel  = row.querySelector("select");
          if (name && !sel.value) {
            hasUnclassified = true;
            sel.classList.add("unclassified-highlight");
          }
          return name ? [name, sel.value || "none"] : null;
        })
        .filter(Boolean);
      if (hasUnclassified) {
        missing.push(i);
        answers.push(null);
        continue;
      }
      value = pairs.length ? pairs : fallback(q);
    } else if (rtype === "String") {
      empty = !value || !value.trim();
    }

    if (empty) {
      if (optional(q)) { answers.push(fallback(q)); continue; }
      missing.push(i);
      answers.push(null);      /* placeholder to keep indices aligned */
      continue;
    }

    answers.push(value);
  }

  if (missing.length > 0) {
    /* Highlight every missing field */
    missing.forEach((idx) => {
      const el = document.getElementById(`q-${idx}`);
      const group = el ? el.closest(".question-group") : null;
      if (group) group.classList.add("missing-field");
    });
    /* Scroll to the first one */
    const firstEl = document.getElementById(`q-${missing[0]}`);
    const firstGroup = firstEl ? firstEl.closest(".question-group") : null;
    if (firstGroup) firstGroup.scrollIntoView({ behavior: "smooth", block: "center" });
    return null;
  }

  return answers;
}

/* ------------------------------------------------------------------ */
/*  Submit + navigate to next page                                     */
/* ------------------------------------------------------------------ */

async function submitAndNavigate(questions) {
  showError("");
  const answers = collectAnswers(questions);
  if (!answers) {
    showError("Please answer all questions before submitting.");
    return;
  }

  try {
    const next = await engine.submitAnswers(answers);
    sessionStorage.removeItem("current_questions");
    sessionStorage.removeItem("current_filenames");
    if (next.status === 'data_collected') {
      window.location.href = 'results.html';
    } else if (next.status === 'early_exit') {
      sessionStorage.setItem('early_exit_messages', JSON.stringify(next.messages));
      window.location.href = 'results.html';
    } else if (next.questions && next.filenames) {
      storeAndNavigate(next.questions, next.filenames);
    }
  } catch (err) {
    showError(String(err));
  }
}


