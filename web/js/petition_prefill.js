/* Convert the static screening engine's saved state into petition form data. */

(function (global) {
  "use strict";

  const OUTCOME_TEXT = {
    1: "Petitioner was convicted",
    2: "the case was dismissed",
    3: "the deferred judgment expired and the case was dismissed",
    4: "the case was dismissed upon completion of drug court",
  };

  const DISMISSAL_REASONS = {
    2: "",
    3: "after the deferred judgment expired",
    4: "upon completion of drug court",
  };

  const ELIGIBILITY_AUTHORITIES = [
    {
      matchPhrases: ["reclassification as misdemeanor"],
      categoryNumber: "16",
      statutoryLanguage:
        "The person was convicted of a nonviolent felony offense not listed in Section 571 " +
        "of Title 57 of the Oklahoma Statutes which was subsequently reclassified as a " +
        "misdemeanor under Oklahoma law, the person is not currently serving a sentence for " +
        "a crime in this state or another state, at least thirty (30) days have passed since " +
        "the completion or commutation of the sentence for the crime that was reclassified " +
        "as a misdemeanor, any restitution ordered by the court to be paid by the person has " +
        "been satisfied in full, and any treatment program ordered by the court has been " +
        "successfully completed by the person, including any person who failed a treatment " +
        "program which resulted in an accelerated or revoked sentence that has since been " +
        "successfully completed by the person or the person can show successful completion " +
        "of a treatment program at a later date. Persons seeking an expungement of records " +
        "under the provisions of this paragraph may utilize the expungement forms provided " +
        "in Section 18a of this title.",
    },
    {
      matchPhrases: ["nonviolent felony criteria"],
      categoryNumber: "12",
      statutoryLanguage:
        "The person was convicted of a nonviolent felony offense not listed in Section 571 " +
        "of Title 57 of the Oklahoma Statutes, the person has not been convicted of any other " +
        "felony, the person has not been convicted of a separate misdemeanor in the last " +
        "seven (7) years, no felony or misdemeanor charges are pending against the person and " +
        "at least five (5) years have passed since the completion of the sentence for the " +
        "felony conviction;",
    },
    {
      matchPhrases: ["no counts listed in section 13"],
      categoryNumber: "13",
      statutoryLanguage:
        "The person was convicted of not more than two felony offenses, none of which is a " +
        "felony offense listed in Section 13.1 of Title 21 of the Oklahoma Statutes or any " +
        "offense that would require the person to register pursuant to the provisions of the " +
        "Sex Offenders Registration Act, no felony or misdemeanor charges are pending " +
        "against the person, and at least ten (10) years have passed since the completion of " +
        "the sentence for the felony conviction;",
    },
    {
      matchPhrases: ["fine < $501"],
      categoryNumber: "10",
      statutoryLanguage:
        "The person was convicted of a misdemeanor offense, the person was sentenced to a " +
        "fine less than Five Hundred One Dollars ($501.00) without a term of imprisonment or " +
        "a suspended sentence, the fine has been paid or satisfied by time served in lieu of " +
        "the fine, the person has not been convicted of a felony and no felony or misdemeanor " +
        "charges are pending against the person;",
    },
    {
      matchPhrases: [">= 5 years since sentencing"],
      categoryNumber: "11",
      statutoryLanguage:
        "The person was convicted of a misdemeanor offense, the person was sentenced to a " +
        "term of imprisonment, a suspended sentence or a fine in an amount greater than Five " +
        "Hundred Dollars ($500.00), the person has not been convicted of a felony, no felony " +
        "or misdemeanor charges are pending against the person and at least five (5) years " +
        "have passed since the end of the last misdemeanor sentence;",
    },
    {
      matchPhrases: ["> 1 year since dismissal"],
      categoryNumber: "8",
      statutoryLanguage:
        "The person was charged with a misdemeanor, the charge was dismissed following the " +
        "successful completion of a deferred judgment or delayed sentence, the person has " +
        "never been convicted of a felony, no misdemeanor or felony charges are pending " +
        "against the person and at least one (1) year has passed since the charge was " +
        "dismissed;",
    },
    {
      matchPhrases: ["the sol has expired"],
      categoryNumber: "7",
      statutoryLanguage:
        "The person was charged with one or more misdemeanor or felony crimes, all charges " +
        "have been dismissed, the person has never been convicted of a felony, no misdemeanor " +
        "or felony charges are pending against the person and the statute of limitations for " +
        "refiling the charge or charges has expired or the prosecuting agency confirms that " +
        "the charge or charges will not be refiled; provided, however, this category shall not " +
        "apply to charges that have been dismissed following the completion of a deferred " +
        "judgment or delayed sentence;",
    },
    {
      matchPhrases: ["arrest no charges filed"],
      categoryNumber: "5",
      statutoryLanguage:
        "The person was arrested and no charges of any type, including charges for an " +
        "offense different than that for which the person was originally arrested, are filed " +
        "and the statute of limitations has expired or the prosecuting agency has declined " +
        "to file charges;",
    },
  ];

  function isEligibleVerdict(verdict) {
    const text = String(verdict || "").toLowerCase();
    return text.includes("expungeable") && !text.includes("not expungeable");
  }

  function eligibilityAuthority(verdict) {
    const normalized = String(verdict || "").replace(/\s+/g, " ").trim().toLowerCase();
    const match = ELIGIBILITY_AUTHORITIES.find((authority) =>
      authority.matchPhrases.some((phrase) => normalized.includes(phrase))
    );
    if (!match) return null;
    return {
      category_number: match.categoryNumber,
      statutory_language: match.statutoryLanguage,
    };
  }

  function storedDate(value) {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "string") {
      const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) {
        return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
      }
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isoDate(value) {
    const date = storedDate(value);
    if (!date) return "";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function displayDate(value) {
    const date = storedDate(value);
    if (!date) return "";
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  function countyFromCourt(court) {
    const text = String(court || "").trim();
    if (!text) return "";
    for (const pattern of [/\bof\s+(.+?)\s+County\b/i, /^(.+?)\s+County\b/i]) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return "";
  }

  function verdictsFromResults(results) {
    const verdicts = {};
    for (const item of Array.isArray(results) ? results : []) {
      if (item && item.type && item.type !== "cases") continue;
      const cases = item && item.type === "cases" ? item.data : item;
      if (!cases || typeof cases !== "object" || Array.isArray(cases)) continue;
      for (const [caseName, value] of Object.entries(cases)) {
        verdicts[String(caseName)] = String(
          value && typeof value === "object" ? value.verdict || "" : value || ""
        );
      }
    }
    return verdicts;
  }

  function casePrefill(caseData, kind, caseLevel, sourceType) {
    const court = String(caseData.court || "");
    const caseName = String(caseData.case_name || "");
    const outcome = Number(caseData.convic_dismiss_defer_drug);
    const counts = Array.isArray(caseData.counts) ? caseData.counts : [];
    const offenses = counts
      .filter((item) => Array.isArray(item) && item.length > 0)
      .map((item) => String(item[0]));

    const importNotes = [];
    const additionalFacts = [];
    const additionalDatedFacts = [];
    const completionDate = displayDate(caseData.sentencing_date);
    if (completionDate) {
      importNotes.push(
        `Screening completion date: ${completionDate} ` +
        "(deferred-sentence expiration, probation completion, or release from incarceration, " +
        "whichever was latest)."
      );
    }
    if (caseData.fines_paid) {
      additionalFacts.push("Petitioner has paid all fines, fees, and restitution.");
    }
    if (caseData.treatment && outcome === 4) {
      additionalFacts.push("Petitioner has completed all required treatment programs.");
    }
    for (const additionalArrest of Array.isArray(caseData.addl_arrests) ? caseData.addl_arrests : []) {
      if (!Array.isArray(additionalArrest) || additionalArrest.length !== 2) continue;
      const date = isoDate(additionalArrest[0]);
      const agency = String(additionalArrest[1] || "").trim();
      if (date && agency) {
        additionalDatedFacts.push({
          date,
          info: `Petitioner was also arrested by ${agency} in connection with this case`,
        });
      }
    }

    const item = {
      kind,
      case_level: caseLevel,
      source_type: sourceType,
      county: countyFromCourt(court),
      arrest_date: isoDate(caseData.arrest_date),
      arresting_agency: String(caseData.arresting_agency || ""),
      offenses: offenses.join("\n"),
      additional_dated_facts: additionalDatedFacts,
      category_number: "",
      statutory_language: "",
      import_notes: importNotes,
    };

    if (kind === "no_file") {
      if (caseName) item.import_notes.unshift(`Screening name: ${caseName}.`);
      Object.assign(item, {
        verification_date: "",
        verified_by: "",
        prosecuting_agency: "",
        record_agency: "",
        eligibility_basis: "",
      });
      return item;
    }

    const resolved = Boolean(caseData.resolved);
    const caseResult = outcome === 1 ? "conviction" : [2, 3, 4].includes(outcome) ? "dismissal" : "";
    const sentenceCompletionDate = caseResult === "conviction" ? isoDate(caseData.sentencing_date) : "";
    Object.assign(item, {
      criminal_case_number: caseName,
      court_name: court,
      event_type: "charged",
      resolved: resolved ? "yes" : "no",
      government_pardon: "",
      case_result: caseResult,
      dismissal_date: caseResult === "dismissal" ? isoDate(caseData.sentencing_date) : "",
      dismissal_reason: DISMISSAL_REASONS[outcome] || "",
      conviction_date: "",
      conviction_method: "",
      sentence_description: "",
      sentence_completion_date: sentenceCompletionDate,
      count_sentences: caseResult === "conviction"
        ? offenses.map((offense, index) => ({
            count_number: index + 1,
            offense,
            applies_to_all: offenses.length === 1,
            conviction_date: "",
            conviction_method: "",
            sentence_description: "",
            sentence_completion_date: sentenceCompletionDate,
          }))
        : [],
      disposition_date: [3, 4].includes(outcome) ? isoDate(caseData.sentencing_date) : "",
      disposition: OUTCOME_TEXT[outcome] || "",
      additional_facts: additionalFacts.join("\n"),
    });
    return item;
  }

  function buildPetitionPrefill(state, results) {
    const cases = state && state.cases && typeof state.cases === "object" ? state.cases : {};
    const felonies = Array.isArray(cases.felonies) ? cases.felonies : [];
    const misdemeanors = Array.isArray(cases.misdos) ? cases.misdos : [];
    const arrests = Array.isArray(cases.arrests) ? cases.arrests : [];
    const verdicts = verdictsFromResults(results);
    const matters = [];

    const typedCases = [
      ...felonies.map((caseData) => [caseData, "regular", "felony", "Felony"]),
      ...misdemeanors.map((caseData) => [caseData, "regular", "misdemeanor", "Misdemeanor"]),
      ...arrests.map((caseData) => [caseData, "no_file", "arrest", "Arrest"]),
    ];

    for (const [caseData, kind, caseLevel, sourceType] of typedCases) {
      const caseName = String(caseData.case_name || "");
      const verdict = verdicts[caseName] || "";
      if (!isEligibleVerdict(verdict)) continue;

      const item = casePrefill(caseData, kind, caseLevel, sourceType);
      item.verdict = verdict;
      const authority = eligibilityAuthority(verdict);
      if (authority) {
        Object.assign(item, authority);
        item.import_notes.push(
          `Eligibility authority imported from the screening result: ` +
          `22 O.S. Section 18(A)(${authority.category_number}).`
        );
      }
      matters.push(item);
    }

    return {
      cases: matters,
      eligible_count: matters.length,
      screening_case_count: typedCases.length,
    };
  }

  function readCompletedEngineState(storage) {
    try {
      const raw = storage && storage.getItem("engine_state");
      if (!raw) return null;
      const state = JSON.parse(raw);
      return state && state.phase === "done" ? state : null;
    } catch (_error) {
      return null;
    }
  }

  global.petitionPrefill = {
    buildPetitionPrefill,
    eligibilityAuthority,
    isEligibleVerdict,
    readCompletedEngineState,
  };
})(window);
