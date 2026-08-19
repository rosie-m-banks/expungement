"""Translate completed screening data into petition-form prefill values."""

from __future__ import annotations

import re
from typing import Any


OUTCOME_TEXT = {
    1: "Petitioner was convicted",
    2: "the case was dismissed",
    3: "the deferred judgment expired and the case was dismissed",
    4: "the case was dismissed upon completion of drug court",
}

DISMISSAL_REASONS = {
    2: "",
    3: "after the deferred judgment expired",
    4: "upon completion of drug court",
}

ELIGIBILITY_AUTHORITIES = (
    {
        "match_phrases": ("reclassification as misdemeanor",),
        "category_number": "16",
        "statutory_language": (
            "The person was convicted of a nonviolent felony offense not listed in Section 571 "
            "of Title 57 of the Oklahoma Statutes which was subsequently reclassified as a "
            "misdemeanor under Oklahoma law, the person is not currently serving a sentence for "
            "a crime in this state or another state, at least thirty (30) days have passed since "
            "the completion or commutation of the sentence for the crime that was reclassified "
            "as a misdemeanor, any restitution ordered by the court to be paid by the person has "
            "been satisfied in full, and any treatment program ordered by the court has been "
            "successfully completed by the person, including any person who failed a treatment "
            "program which resulted in an accelerated or revoked sentence that has since been "
            "successfully completed by the person or the person can show successful completion "
            "of a treatment program at a later date. Persons seeking an expungement of records "
            "under the provisions of this paragraph may utilize the expungement forms provided "
            "in Section 18a of this title."
        ),
    },
    {
        "match_phrases": ("nonviolent felony criteria",),
        "category_number": "12",
        "statutory_language": (
            "The person was convicted of a nonviolent felony offense not listed in Section 571 "
            "of Title 57 of the Oklahoma Statutes, the person has not been convicted of any other "
            "felony, the person has not been convicted of a separate misdemeanor in the last "
            "seven (7) years, no felony or misdemeanor charges are pending against the person and "
            "at least five (5) years have passed since the completion of the sentence for the "
            "felony conviction;"
        ),
    },
    {
        "match_phrases": ("no counts listed in section 13",),
        "category_number": "13",
        "statutory_language": (
            "The person was convicted of not more than two felony offenses, none of which is a "
            "felony offense listed in Section 13.1 of Title 21 of the Oklahoma Statutes or any "
            "offense that would require the person to register pursuant to the provisions of the "
            "Sex Offenders Registration Act, no felony or misdemeanor charges are pending "
            "against the person, and at least ten (10) years have passed since the completion of "
            "the sentence for the felony conviction;"
        ),
    },
    {
        "match_phrases": ("fine < $501",),
        "category_number": "10",
        "statutory_language": (
            "The person was convicted of a misdemeanor offense, the person was sentenced to a "
            "fine less than Five Hundred One Dollars ($501.00) without a term of imprisonment or "
            "a suspended sentence, the fine has been paid or satisfied by time served in lieu of "
            "the fine, the person has not been convicted of a felony and no felony or misdemeanor "
            "charges are pending against the person;"
        ),
    },
    {
        "match_phrases": (">= 5 years since sentencing",),
        "category_number": "11",
        "statutory_language": (
            "The person was convicted of a misdemeanor offense, the person was sentenced to a "
            "term of imprisonment, a suspended sentence or a fine in an amount greater than Five "
            "Hundred Dollars ($500.00), the person has not been convicted of a felony, no felony "
            "or misdemeanor charges are pending against the person and at least five (5) years "
            "have passed since the end of the last misdemeanor sentence;"
        ),
    },
    {
        "match_phrases": ("> 1 year since dismissal",),
        "category_number": "8",
        "statutory_language": (
            "The person was charged with a misdemeanor, the charge was dismissed following the "
            "successful completion of a deferred judgment or delayed sentence, the person has "
            "never been convicted of a felony, no misdemeanor or felony charges are pending "
            "against the person and at least one (1) year has passed since the charge was "
            "dismissed;"
        ),
    },
    {
        "match_phrases": ("the sol has expired",),
        "category_number": "7",
        "statutory_language": (
            "The person was charged with one or more misdemeanor or felony crimes, all charges "
            "have been dismissed, the person has never been convicted of a felony, no misdemeanor "
            "or felony charges are pending against the person and the statute of limitations for "
            "refiling the charge or charges has expired or the prosecuting agency confirms that "
            "the charge or charges will not be refiled; provided, however, this category shall not "
            "apply to charges that have been dismissed following the completion of a deferred "
            "judgment or delayed sentence;"
        ),
    },
    {
        "match_phrases": ("arrest no charges filed",),
        "category_number": "5",
        "statutory_language": (
            "The person was arrested and no charges of any type, including charges for an "
            "offense different than that for which the person was originally arrested, are filed "
            "and the statute of limitations has expired or the prosecuting agency has declined "
            "to file charges;"
        ),
    },
)


def is_eligible_verdict(verdict: Any) -> bool:
    text = str(verdict or "").lower()
    return "expungeable" in text and "not expungeable" not in text


def eligibility_authority(verdict: Any) -> dict[str, str] | None:
    """Return the supplied Section 18(A) authority for a screening verdict."""
    normalized = re.sub(r"\s+", " ", str(verdict or "")).strip().lower()
    for authority in ELIGIBILITY_AUTHORITIES:
        if any(phrase in normalized for phrase in authority["match_phrases"]):
            return {
                "category_number": authority["category_number"],
                "statutory_language": authority["statutory_language"],
            }
    return None


def _iso_date(value: Any) -> str:
    return value.strftime("%Y-%m-%d") if hasattr(value, "strftime") else ""


def _display_date(value: Any) -> str:
    if hasattr(value, "strftime"):
        return value.strftime("%B %-d, %Y")
    return ""


def _county_from_court(court: Any) -> str:
    text = str(court or "").strip()
    if not text:
        return ""
    for pattern in (
        r"\bof\s+(.+?)\s+County\b",
        r"^(.+?)\s+County\b",
    ):
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ""


def _verdicts_from_results(results: list | None) -> dict[str, str]:
    verdicts: dict[str, str] = {}
    for item in results or []:
        if not isinstance(item, dict):
            continue
        for case_name, value in item.items():
            if isinstance(value, dict):
                verdicts[str(case_name)] = str(value.get("verdict", ""))
            else:
                verdicts[str(case_name)] = str(value)
    return verdicts


def _case_prefill(case: Any, kind: str, case_level: str) -> dict[str, Any]:
    court = str(getattr(case, "court", "") or "")
    case_name = str(getattr(case, "case_name", "") or "")
    arrest_date = getattr(case, "arrest_date", None)
    sentencing_date = getattr(case, "sentencing_date", None)
    outcome = getattr(case, "convic_dismiss_defer_drug", None)
    counts = getattr(case, "counts", []) or []
    offenses = [str(item[0]) for item in counts if isinstance(item, (list, tuple)) and item]

    notes: list[str] = []
    additional_facts: list[str] = []
    additional_dated_facts: list[dict[str, str]] = []
    completion_date = _display_date(sentencing_date)
    if completion_date:
        notes.append(
            "Screening completion date: "
            f"{completion_date} (deferred-sentence expiration, probation completion, "
            "or release from incarceration, whichever was latest)."
        )
    if getattr(case, "fines_paid", False):
        additional_facts.append("Petitioner has paid all fines, fees, and restitution.")
    if getattr(case, "treatment", False) and outcome == 4:
        additional_facts.append("Petitioner has completed all required treatment programs.")
    for item in getattr(case, "addl_arrests", []) or []:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        additional_date, additional_agency = item
        iso_date = _iso_date(additional_date)
        if iso_date and additional_agency:
            additional_dated_facts.append({
                "date": iso_date,
                "info": (
                    f"Petitioner was also arrested by {additional_agency} "
                    "in connection with this case"
                ),
            })

    item: dict[str, Any] = {
        "kind": kind,
        "case_level": case_level,
        "source_type": type(case).__name__,
        "county": _county_from_court(court),
        "arrest_date": _iso_date(arrest_date),
        "arresting_agency": str(getattr(case, "arresting_agency", "") or ""),
        "offenses": "\n".join(offenses),
        "additional_dated_facts": additional_dated_facts,
        "category_number": "",
        "statutory_language": "",
        "import_notes": notes,
    }

    if kind == "no_file":
        if case_name:
            item["import_notes"].insert(0, f"Screening name: {case_name}.")
        item.update(
            {
                "verification_date": "",
                "verified_by": "",
                "prosecuting_agency": "",
                "record_agency": "",
                "eligibility_basis": "",
            }
        )
    else:
        resolved = bool(getattr(case, "resolved", False))
        case_result = "conviction" if outcome == 1 else "dismissal" if outcome in (2, 3, 4) else ""
        item.update(
            {
                "criminal_case_number": case_name,
                "court_name": court,
                "event_type": "charged",
                "resolved": "yes" if resolved else "no",
                "government_pardon": "",
                "case_result": case_result,
                "dismissal_date": _iso_date(sentencing_date) if case_result == "dismissal" else "",
                "dismissal_reason": DISMISSAL_REASONS.get(outcome, ""),
                "conviction_date": "",
                "conviction_method": "",
                "sentence_description": "",
                "sentence_completion_date": _iso_date(sentencing_date) if case_result == "conviction" else "",
                "disposition_date": _iso_date(sentencing_date) if outcome in (3, 4) else "",
                "disposition": OUTCOME_TEXT.get(outcome, ""),
                "additional_facts": "\n".join(additional_facts),
            }
        )
    return item


def build_petition_prefill(
    misdemeanors: list | None,
    felonies: list | None,
    arrests: list | None,
    results: list | None,
) -> dict[str, Any]:
    """Return eligible screening matters in petition-form shape."""
    verdicts = _verdicts_from_results(results)
    matters: list[dict[str, Any]] = []

    typed_cases = [
        *((case, "regular", "felony") for case in felonies or []),
        *((case, "regular", "misdemeanor") for case in misdemeanors or []),
        *((case, "no_file", "arrest") for case in arrests or []),
    ]
    for case, kind, case_level in typed_cases:
        case_name = str(getattr(case, "case_name", "") or "")
        verdict = verdicts.get(case_name, "")
        if not is_eligible_verdict(verdict):
            continue
        item = _case_prefill(case, kind, case_level)
        item["verdict"] = verdict
        authority = eligibility_authority(verdict)
        if authority:
            item.update(authority)
            item["import_notes"].append(
                "Eligibility authority imported from the screening result: "
                f"22 O.S. Section 18(A)({authority['category_number']})."
            )
        matters.append(item)

    return {
        "cases": matters,
        "eligible_count": len(matters),
        "screening_case_count": len(typed_cases),
    }
