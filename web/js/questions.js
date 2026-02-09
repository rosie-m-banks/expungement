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
    label.textContent = q.question;
    label.setAttribute("for", `q-${i}`);
    group.appendChild(label);

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
    } else if (rtype === "StringList") {
      const textarea = document.createElement("textarea");
      textarea.id = `q-${i}`;
      textarea.name = `q-${i}`;
      textarea.placeholder = "Enter items separated by commas";
      textarea.rows = 3;
      group.appendChild(textarea);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.id = `q-${i}`;
      input.name = `q-${i}`;
      input.placeholder = "Your answer";
      group.appendChild(input);
    }

    form.appendChild(group);
  });
}

/* ------------------------------------------------------------------ */
/*  Collect answers                                                    */
/* ------------------------------------------------------------------ */

function collectAnswers(questions) {
  const answers = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const el = document.getElementById(`q-${i}`);
    if (!el) return null;

    let value = el.value;

    if (q.response_type === "Boolean") {
      if (!value) return null;
    } else if (q.response_type === "Date") {
      if (!value) return null;
      const [year, month, day] = value.split("-");
      value = `${month}-${day}-${year}`;
    } else if (q.response_type === "Int" || q.response_type === "Float") {
      if (value === "" || value === undefined) return null;
    } else if (q.response_type === "String") {
      if (!value || !value.trim()) return null;
    }

    answers.push(value);
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
    await postJson("/api/answers", {
      session_id: getSessionId(),
      answers: answers,
    });
    // Clear consumed questions, then poll for the next batch
    sessionStorage.removeItem("current_questions");
    sessionStorage.removeItem("current_filenames");
    pollAndNavigate();
  } catch (err) {
    showError(String(err));
  }
}


