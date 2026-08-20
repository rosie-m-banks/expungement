"""Generate a court-style Oklahoma expungement petition PDF.

The pleading language follows the user-supplied research template. Statutory
category text is deliberately supplied by the user and is never inferred here.
"""

from __future__ import annotations

import html
import io
import re
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


CASE_KINDS = {"regular", "pardon", "no_file"}
CASE_LEVEL_ORDER = {"felony": 0, "misdemeanor": 1, "arrest": 2}
MAX_CASES = 12
MAX_TEXT_LENGTH = 12_000


class PetitionValidationError(ValueError):
    """Raised when petition input is incomplete or malformed."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


def _clean(value: Any, *, limit: int = MAX_TEXT_LENGTH) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\x00", "").strip()
    return text[:limit]


def _required(data: dict[str, Any], key: str, label: str, errors: list[str]) -> str:
    value = _clean(data.get(key))
    if not value:
        errors.append(f"{label} is required.")
    return value


def _date(
    value: Any,
    label: str,
    errors: list[str],
    *,
    required: bool = True,
    output_format: str = "%B %-d, %Y",
) -> str:
    raw = _clean(value, limit=40)
    if not raw:
        if required:
            errors.append(f"{label} is required.")
        return ""
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime(output_format)
        except ValueError:
            continue
    errors.append(f"{label} must be a valid date.")
    return raw


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        candidates = value
    else:
        candidates = str(value or "").splitlines()
    return [_clean(item, limit=1_000) for item in candidates if _clean(item, limit=1_000)]


def _sentence_fragment(value: Any) -> str:
    """Return user-entered sentence text without duplicate terminal punctuation."""
    return _clean(value, limit=1_000).rstrip().rstrip(".")


def _dated_facts(value: Any, label: str, errors: list[str]) -> list[dict[str, str]]:
    """Validate optional date-and-information pairs for numbered allegations."""
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        errors.append(f"{label} must be a list.")
        return []
    if len(value) > 30:
        errors.append(f"{label} may include no more than 30 entries.")

    facts: list[dict[str, str]] = []
    for index, raw_fact in enumerate(value[:30], start=1):
        fact_label = f"{label} entry {index}"
        if not isinstance(raw_fact, dict):
            errors.append(f"{fact_label} must include a date and information.")
            continue
        fact_date = _date(
            raw_fact.get("date"),
            f"{fact_label} date",
            errors,
            output_format="%m/%d/%Y",
        )
        information = _sentence_fragment(
            _required(raw_fact, "info", f"{fact_label} information", errors)
        )
        if fact_date and information:
            facts.append({"date": fact_date, "info": information})
    return facts


def _dismissal_reason(value: Any) -> str:
    """Normalize a dismissal reason so the generator owns the allegation wording."""
    reason = _sentence_fragment(value)
    prefix = "the case was dismissed"
    if reason.lower().startswith(prefix):
        reason = reason[len(prefix):].strip()
    return reason


def _conviction_method(value: Any) -> str:
    """Accept either 'pled' or 'Petitioner pled' without repeating Petitioner."""
    method = _sentence_fragment(value)
    prefix = "petitioner "
    if method.lower().startswith(prefix):
        method = method[len(prefix):].strip()
    return method


def _count_sentences(
    value: Any,
    offenses: list[str],
    prefix: str,
    errors: list[str],
) -> list[dict[str, Any]]:
    """Validate count-level conviction and sentence facts."""
    if not isinstance(value, list):
        errors.append(f"{prefix} count sentences must be a list.")
        return []
    if len(value) > 30:
        errors.append(f"{prefix} may include no more than 30 count sentences.")

    sentences: list[dict[str, Any]] = []
    for index, raw_sentence in enumerate(value[:30], start=1):
        sentence_prefix = f"{prefix} count {index}"
        if not isinstance(raw_sentence, dict):
            errors.append(f"{sentence_prefix} sentence must be an object.")
            continue

        applies_to_all = raw_sentence.get("applies_to_all") is True
        count_number = None
        offense = ""
        if not applies_to_all:
            try:
                count_number = int(raw_sentence.get("count_number") or index)
            except (TypeError, ValueError):
                count_number = 0
            if count_number < 1 or count_number > len(offenses):
                errors.append(f"{sentence_prefix} must identify a valid count number.")
            elif offenses:
                offense = offenses[count_number - 1]

        method = _conviction_method(
            _required(raw_sentence, "conviction_method", f"{sentence_prefix} conviction method", errors)
        )
        sentence = _sentence_fragment(
            _required(raw_sentence, "sentence_description", f"{sentence_prefix} sentence", errors)
        )
        sentences.append({
            "count_number": count_number,
            "offense": offense,
            "applies_to_all": applies_to_all,
            "conviction_date": _date(
                raw_sentence.get("conviction_date"),
                f"{sentence_prefix} conviction date",
                errors,
                output_format="%m/%d/%Y",
            ),
            "conviction_method": method,
            "sentence_description": sentence,
            "sentence_completion_date": _date(
                raw_sentence.get("sentence_completion_date"),
                f"{sentence_prefix} sentence completion date",
                errors,
                output_format="%m/%d/%Y",
            ),
        })

    shared = [sentence for sentence in sentences if sentence["applies_to_all"]]
    if shared and len(sentences) != 1:
        errors.append(f"{prefix} must use either one shared sentence or one sentence per count.")
    if not shared and len(sentences) != len(offenses):
        errors.append(f"{prefix} must include one sentence for each count.")
    if not shared and sorted(sentence["count_number"] for sentence in sentences) != list(
        range(1, len(offenses) + 1)
    ):
        errors.append(f"{prefix} must include each count exactly once.")
    if not shared:
        sentences.sort(key=lambda sentence: sentence["count_number"])
    return sentences


def _case_level(raw_case: dict[str, Any], kind: str) -> str:
    """Return an explicit level or infer one for legacy petition payloads."""
    level = _clean(raw_case.get("case_level"), limit=30).lower()
    if level:
        return level
    if kind == "no_file":
        return "arrest"

    case_number = _clean(raw_case.get("criminal_case_number"), limit=80).upper()
    if re.match(r"^(CF|CRF)(?:-|\b)", case_number):
        return "felony"
    if re.match(r"^(CM|CRM)(?:-|\b)", case_number):
        return "misdemeanor"
    if kind == "pardon":
        return "felony"
    return ""


def validate_petition_payload(payload: Any) -> dict[str, Any]:
    """Validate and normalize browser input for deterministic PDF generation."""
    if not isinstance(payload, dict):
        raise PetitionValidationError(["Petition data must be a JSON object."])

    errors: list[str] = []
    normalized: dict[str, Any] = {
        "court_county": _required(payload, "court_county", "Filing county", errors),
        "civil_case_number": _clean(payload.get("civil_case_number"), limit=80),
        "petitioner_name": _required(payload, "petitioner_name", "Petitioner's full legal name", errors),
        "dob": _date(payload.get("dob"), "Date of birth", errors),
        "representation": _clean(payload.get("representation"), limit=20) or "pro_se",
        "signer_name": _required(payload, "signer_name", "Signer name", errors),
        "oba_number": _clean(payload.get("oba_number"), limit=40),
        "organization": _clean(payload.get("organization"), limit=180),
        "street_address": _required(payload, "street_address", "Mailing address", errors),
        "city_state_zip": _required(payload, "city_state_zip", "City, state, and ZIP", errors),
        "phone": _required(payload, "phone", "Telephone", errors),
        "email": _required(payload, "email", "Email", errors),
    }

    if normalized["representation"] not in {"counsel", "pro_se"}:
        errors.append("Representation must be counsel or pro se.")
    if normalized["representation"] == "counsel" and not normalized["oba_number"]:
        errors.append("OBA number is required when represented by counsel.")

    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        errors.append("At least one case or arrest is required.")
        raw_cases = []
    if len(raw_cases) > MAX_CASES:
        errors.append(f"No more than {MAX_CASES} matters may be included in one draft.")

    cases: list[dict[str, Any]] = []
    for index, raw_case in enumerate(raw_cases[:MAX_CASES], start=1):
        prefix = f"Matter {index}"
        if not isinstance(raw_case, dict):
            errors.append(f"{prefix} must be an object.")
            continue
        kind = _clean(raw_case.get("kind"), limit=30)
        if kind not in CASE_KINDS:
            errors.append(f"{prefix} has an invalid petition type.")
            continue

        case: dict[str, Any] = {
            "kind": kind,
            "case_level": _case_level(raw_case, kind),
            "county": _required(raw_case, "county", f"{prefix} county", errors),
            "arrest_date": _date(raw_case.get("arrest_date"), f"{prefix} arrest date", errors),
            "arresting_agency": _required(raw_case, "arresting_agency", f"{prefix} arresting agency", errors),
            "offenses": _string_list(raw_case.get("offenses")),
            "additional_dated_facts": _dated_facts(
                raw_case.get("additional_dated_facts"),
                f"{prefix} additional dated facts",
                errors,
            ),
            "category_number": _required(raw_case, "category_number", f"{prefix} Section 18(A) category", errors),
            "statutory_language": _required(
                raw_case,
                "statutory_language",
                f"{prefix} attorney-verified statutory language",
                errors,
            ),
        }
        if not case["offenses"]:
            errors.append(f"{prefix} must include at least one offense.")
        if case["case_level"] not in CASE_LEVEL_ORDER:
            errors.append(f"{prefix} case level must be felony, misdemeanor, or arrest.")
        if kind in {"regular", "pardon"} and case["case_level"] == "arrest":
            errors.append(f"{prefix} filed case level must be felony or misdemeanor.")
        if kind == "no_file" and case["case_level"] != "arrest":
            errors.append(f"{prefix} no-file matter must use the arrest case level.")

        if kind == "regular":
            disposition_type = _clean(raw_case.get("disposition_type"), limit=30) or "other"
            case.update({
                "criminal_case_number": _required(
                    raw_case, "criminal_case_number", f"{prefix} criminal case number", errors
                ),
                "court_name": _required(raw_case, "court_name", f"{prefix} court name", errors),
                "event_type": _clean(raw_case.get("event_type"), limit=30) or "charged",
                "disposition_type": disposition_type,
                "additional_facts": _string_list(raw_case.get("additional_facts")),
            })
            if disposition_type == "dismissal":
                dismissal_reason = _dismissal_reason(
                    _required(raw_case, "dismissal_reason", f"{prefix} dismissal reason", errors)
                )
                if not dismissal_reason and _clean(raw_case.get("dismissal_reason")):
                    errors.append(f"{prefix} dismissal reason must explain why the case was dismissed.")
                case.update({
                    "disposition_date": _date(
                        raw_case.get("dismissal_date"),
                        f"{prefix} dismissal date",
                        errors,
                        output_format="%m/%d/%Y",
                    ),
                    "disposition": f"the case was dismissed {dismissal_reason}".strip(),
                    "dismissal_reason": dismissal_reason,
                    "sentence_completion_date": "",
                })
            elif disposition_type == "conviction":
                raw_count_sentences = raw_case.get("count_sentences")
                if raw_count_sentences not in (None, "", []):
                    count_sentences = _count_sentences(
                        raw_count_sentences,
                        case["offenses"],
                        prefix,
                        errors,
                    )
                    first_sentence = count_sentences[0] if count_sentences else {}
                    method = first_sentence.get("conviction_method", "")
                    sentence = first_sentence.get("sentence_description", "")
                    conviction_date = first_sentence.get("conviction_date", "")
                    completion_date = first_sentence.get("sentence_completion_date", "")
                    case.update({
                        "count_sentences": count_sentences,
                        "disposition_date": conviction_date,
                        "disposition": f"Petitioner {method} and received {sentence}".strip(),
                        "conviction_method": method,
                        "sentence_description": sentence,
                        "sentence_completion_date": completion_date,
                    })
                else:
                    method = _conviction_method(
                        _required(raw_case, "conviction_method", f"{prefix} conviction method", errors)
                    )
                    sentence = _sentence_fragment(
                        _required(raw_case, "sentence_description", f"{prefix} sentence", errors)
                    )
                    conviction_date = _date(
                        raw_case.get("conviction_date"),
                        f"{prefix} conviction date",
                        errors,
                        output_format="%m/%d/%Y",
                    )
                    case.update({
                        "count_sentences": [],
                        "disposition_date": conviction_date,
                        "disposition": f"Petitioner {method} and received {sentence}".strip(),
                        "conviction_method": method,
                        "sentence_description": sentence,
                        "sentence_completion_date": _date(
                            raw_case.get("sentence_completion_date"),
                            f"{prefix} sentence completion date",
                            errors,
                            output_format="%m/%d/%Y",
                        ),
                    })
            elif disposition_type == "other":
                case.update({
                    "disposition_date": _date(
                        raw_case.get("disposition_date"), f"{prefix} disposition date", errors
                    ),
                    "disposition": _required(
                        raw_case, "disposition", f"{prefix} disposition", errors
                    ),
                    "sentence_completion_date": "",
                })
            else:
                errors.append(f"{prefix} disposition type must be dismissal, conviction, or other.")
                case.update({
                    "disposition_date": "",
                    "disposition": "",
                    "sentence_completion_date": "",
                })
            if case["event_type"] not in {"arrested", "cited", "charged"}:
                errors.append(f"{prefix} event type must be arrested, cited, or charged.")
        elif kind == "pardon":
            case.update(
                {
                    "criminal_case_number": _required(
                        raw_case, "criminal_case_number", f"{prefix} criminal case number", errors
                    ),
                    "doc_number": _clean(raw_case.get("doc_number"), limit=80),
                    "pardon_date": _date(raw_case.get("pardon_date"), f"{prefix} pardon date", errors),
                    "exhibit_label": _clean(raw_case.get("exhibit_label"), limit=30) or "A",
                }
            )
        else:
            case.update(
                {
                    "verification_date": _date(
                        raw_case.get("verification_date"), f"{prefix} verification date", errors
                    ),
                    "verified_by": _required(raw_case, "verified_by", f"{prefix} verifying person", errors),
                    "prosecuting_agency": _required(
                        raw_case, "prosecuting_agency", f"{prefix} prosecuting agency", errors
                    ),
                    "record_agency": _required(
                        raw_case, "record_agency", f"{prefix} court or record-holding agency", errors
                    ),
                    "eligibility_basis": _required(
                        raw_case, "eligibility_basis", f"{prefix} no-file eligibility basis", errors
                    ),
                }
            )
        cases.append(case)

    cases.sort(key=lambda item: CASE_LEVEL_ORDER.get(item["case_level"], 99))
    normalized["cases"] = cases
    if errors:
        raise PetitionValidationError(errors)
    return normalized


def _markup(text: Any) -> str:
    return html.escape(_clean(text)).replace("\n", "<br/>")


def _plain_join(values: list[str]) -> str:
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} and {values[1]}"
    return ", ".join(values[:-1]) + f", and {values[-1]}"


def _draw_page(canvas, doc) -> None:
    canvas.saveState()
    width, _ = letter
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(colors.HexColor("#777777"))
    canvas.drawCentredString(width / 2, 0.55 * inch, "DRAFT FOR ATTORNEY REVIEW - NOT FOR FILING")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(width - inch, 0.55 * inch, f"Page {doc.page}")
    canvas.restoreState()


def generate_petition_pdf(payload: Any) -> tuple[bytes, dict[str, Any]]:
    """Return ``(pdf_bytes, normalized_payload)`` for a petition draft."""
    data = validate_petition_payload(payload)
    stream = io.BytesIO()
    doc = SimpleDocTemplate(
        stream,
        pagesize=letter,
        rightMargin=inch,
        leftMargin=inch,
        topMargin=0.72 * inch,
        bottomMargin=0.78 * inch,
        title=f"Petition to Expunge Records - {data['petitioner_name']}",
        author=data["signer_name"],
        subject="Draft petition pursuant to 22 O.S. Sections 18 and 19",
        allowSplitting=True,
    )

    base = getSampleStyleSheet()
    body = ParagraphStyle(
        "PetitionBody",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=13.2,
        textColor=colors.black,
        alignment=TA_LEFT,
        spaceAfter=8,
        allowWidows=0,
        allowOrphans=0,
    )
    body_center = ParagraphStyle("PetitionBodyCenter", parent=body, alignment=TA_CENTER)
    court_style = ParagraphStyle(
        "CourtHeading",
        parent=body_center,
        fontName="Helvetica-Bold",
        fontSize=12.5,
        leading=15,
        spaceAfter=2,
    )
    title_style = ParagraphStyle(
        "PetitionTitle",
        parent=body_center,
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=17,
        spaceBefore=12,
        spaceAfter=12,
    )
    section_style = ParagraphStyle(
        "PetitionSection",
        parent=body_center,
        fontName="Helvetica-Bold",
        fontSize=11.5,
        leading=14,
        spaceBefore=10,
        spaceAfter=8,
        keepWithNext=True,
    )
    statutory_style = ParagraphStyle(
        "StatutoryText",
        parent=body,
        leftIndent=0.28 * inch,
        rightIndent=0.18 * inch,
        spaceBefore=3,
        spaceAfter=10,
    )
    count_style = ParagraphStyle(
        "CountText",
        parent=body,
        leftIndent=0.32 * inch,
        spaceAfter=2,
    )
    small_style = ParagraphStyle(
        "Small",
        parent=body,
        fontSize=8.5,
        leading=10.5,
        spaceAfter=0,
    )

    story: list[Any] = []

    story.append(Paragraph("DRAFT FOR ATTORNEY REVIEW", ParagraphStyle(
        "DraftTop", parent=small_style, alignment=TA_CENTER, fontName="Helvetica-Bold",
        textColor=colors.HexColor("#777777"), spaceAfter=8,
    )))
    story.append(Paragraph(f"IN THE DISTRICT COURT OF {_markup(data['court_county']).upper()} COUNTY", court_style))
    story.append(Paragraph("STATE OF OKLAHOMA", court_style))
    story.append(Spacer(1, 0.12 * inch))

    caption_left = Paragraph(
        f"<b>{_markup(data['petitioner_name']).upper()},</b><br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;Petitioner,<br/><br/>"
        "v.<br/><br/>"
        "<b>THE STATE OF OKLAHOMA,</b><br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;Respondent.",
        body,
    )
    parens = Paragraph(")<br/>)<br/>)<br/>)<br/>)<br/>)", body_center)
    case_number = _markup(data["civil_case_number"]) if data["civil_case_number"] else "To be assigned"
    caption_right = Paragraph(f"<b>Case No. {case_number}</b>", body)
    caption = Table(
        [[caption_left, parens, caption_right]],
        colWidths=[3.75 * inch, 0.22 * inch, 2.53 * inch],
        hAlign="LEFT",
    )
    caption.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(caption)
    story.append(Paragraph("PETITION TO EXPUNGE RECORDS<br/>PURSUANT TO 22 O.S. SECTIONS 18 AND 19", title_style))

    appearance = (
        f"by and through counsel, {_markup(data['signer_name'])},"
        if data["representation"] == "counsel"
        else "appearing pro se,"
    )
    story.append(Paragraph(
        f"<b>COMES NOW</b> Petitioner, {_markup(data['petitioner_name'])}, {appearance} "
        "and pursuant to 22 O.S. Sections 18 and 19, respectfully moves this Court "
        "to expunge the records identified below. In support thereof, Petitioner states as follows:",
        body,
    ))
    story.append(Paragraph("All Cases", section_style))

    paragraph_number = 1

    def allegation(content: str) -> None:
        nonlocal paragraph_number
        number = Paragraph(f"{paragraph_number}.", body)
        text = Paragraph(content, body)
        row = Table([[number, text]], colWidths=[0.38 * inch, 6.12 * inch], hAlign="LEFT")
        row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ]))
        story.append(row)
        paragraph_number += 1

    def add_additional_dated_facts(case: dict[str, Any]) -> None:
        for fact in case["additional_dated_facts"]:
            allegation(
                f"On or about {_markup(fact['date'])}, {_markup(fact['info'])}."
            )

    allegation(
        f"Petitioner is {_markup(data['petitioner_name'])}, date of birth {_markup(data['dob'])}."
    )
    allegation(
        "Petitioner seeks expungement of the criminal and related public civil records arising "
        "from the arrests, charges, and/or cases identified below."
    )
    allegation(
        "The harm to the privacy of Petitioner or danger of unwarranted adverse consequences "
        "outweighs the public interest in retaining the records."
    )

    if len(data["cases"]) > 1:
        allegation(
            "Pursuant to the Oklahoma Pleading Code at 12 O.S. Section 2018, Petitioner may "
            "combine expungement requests for relief into one Petition, including requests which "
            "are subsequent to a predicate ruling."
        )
        story.append(Paragraph(
            "A. JOINDER OF CLAIMS. A party asserting a claim to relief as an original claim, "
            "counterclaim, cross-claim, or third-party claim, may join, either as independent or "
            "as alternate claims, as many claims, legal or equitable, as the party has against an opposing party.",
            statutory_style,
        ))
        story.append(Paragraph(
            "B. JOINDER OF REMEDIES. Whenever a claim is one heretofore cognizable only after "
            "another claim has been prosecuted to a conclusion, the two claims may be joined in a "
            "single action; but the court shall grant relief in that action only in accordance "
            "with the relative substantive rights of the parties.",
            statutory_style,
        ))

    for case_index, case in enumerate(data["cases"]):
        if case_index and len(story) > 24:
            story.append(Spacer(1, 0.08 * inch))

        if case["kind"] == "regular":
            heading = (
                "22 O.S. Sections 18/19 Expungement of "
                f"{_markup(case['criminal_case_number'])} ({_markup(case['county'])} County)"
            )
            story.append(Paragraph(heading, section_style))
            allegation(
                f"On or about {_markup(case['arrest_date'])}, Petitioner was {_markup(case['event_type'])} "
                f"by {_markup(case['arresting_agency'])} for {_markup(_plain_join(case['offenses']))}."
            )
            allegation(
                f"The matter was filed in {_markup(case['court_name'])}, Case No. "
                f"{_markup(case['criminal_case_number'])}."
            )
            allegation("Petitioner was charged with the following offense(s):")
            for count_index, offense in enumerate(case["offenses"], start=1):
                story.append(Paragraph(f"Count {count_index}: {_markup(offense)}", count_style))
            if case["disposition_type"] == "dismissal":
                allegation(
                    f"On or about {_markup(case['disposition_date'])}, the case was dismissed "
                    f"{_markup(case['dismissal_reason'])}."
                )
            elif case["disposition_type"] == "conviction":
                if case.get("count_sentences"):
                    multiple_counts = len(case["offenses"]) > 1
                    for count_sentence in case["count_sentences"]:
                        if count_sentence["applies_to_all"] and multiple_counts:
                            conviction_scope = " as to all counts"
                            completion_scope = " for all counts"
                            received_join = " and"
                        elif multiple_counts:
                            count_label = (
                                f"Count {count_sentence['count_number']}, "
                                f"{_markup(count_sentence['offense'])}"
                            )
                            conviction_scope = f" as to {count_label}"
                            completion_scope = f" for {count_label}"
                            received_join = ", and"
                        else:
                            conviction_scope = ""
                            completion_scope = ""
                            received_join = " and"
                        allegation(
                            f"On or about {_markup(count_sentence['conviction_date'])}, Petitioner "
                            f"{_markup(count_sentence['conviction_method'])}{conviction_scope}"
                            f"{received_join} received {_markup(count_sentence['sentence_description'])}."
                        )
                        allegation(
                            f"On or about {_markup(count_sentence['sentence_completion_date'])}, "
                            f"Petitioner completed the sentence{completion_scope}."
                        )
                else:
                    allegation(
                        f"On or about {_markup(case['disposition_date'])}, Petitioner "
                        f"{_markup(case['conviction_method'])} and received "
                        f"{_markup(case['sentence_description'])}."
                    )
                    allegation(
                        f"On or about {_markup(case['sentence_completion_date'])}, "
                        "Petitioner completed the sentence."
                    )
            else:
                allegation(
                    f"On or about {_markup(case['disposition_date'])}, {_markup(case['disposition'])}."
                )
            add_additional_dated_facts(case)
            for fact in case["additional_facts"]:
                allegation(_markup(fact))
            allegation(
                "Petitioner qualifies to seek expungement pursuant to 22 O.S. Section 18(A)("
                f"{_markup(case['category_number'])})."
            )
            story.append(Paragraph(
                "The applicable statutory category provides, in relevant part:", body
            ))
            story.append(Paragraph(_markup(case["statutory_language"]), statutory_style))
            allegation(
                "Based upon the facts stated above, Petitioner satisfies the requirements of "
                f"22 O.S. Section 18(A)({_markup(case['category_number'])})."
            )

        elif case["kind"] == "pardon":
            story.append(Paragraph(
                "22 O.S. Sections 18/19 Expungement of Crimes Pardoned by Governor",
                section_style,
            ))
            allegation(
                "Petitioner seeks the expungement of the following crime(s), for which Petitioner "
                "has received a full pardon from the Governor. A copy of Petitioner's pardon "
                f"certificate is attached as Exhibit {_markup(case['exhibit_label'])}."
            )
            table_data = [[
                Paragraph("<b>Case Number</b>", small_style),
                Paragraph("<b>Arrest Date</b>", small_style),
                Paragraph("<b>Arresting Agency</b>", small_style),
                Paragraph("<b>DOC Number</b>", small_style),
                Paragraph("<b>Crime(s)</b>", small_style),
            ], [
                Paragraph(_markup(case["criminal_case_number"]), small_style),
                Paragraph(_markup(case["arrest_date"]), small_style),
                Paragraph(_markup(case["arresting_agency"]), small_style),
                Paragraph(_markup(case["doc_number"] or "N/A"), small_style),
                Paragraph(_markup("; ".join(case["offenses"])), small_style),
            ]]
            pardon_table = Table(
                table_data,
                colWidths=[1.05 * inch, 0.9 * inch, 1.65 * inch, 0.85 * inch, 2.05 * inch],
                repeatRows=1,
                hAlign="LEFT",
            )
            pardon_table.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#666666")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.append(pardon_table)
            story.append(Spacer(1, 0.12 * inch))
            story.append(Paragraph(
                "22 O.S. Section 18(A) lists the categories under which a person may be eligible "
                "to have the person's record expunged. The applicable category provides, in relevant part:",
                body,
            ))
            story.append(Paragraph(_markup(case["statutory_language"]), statutory_style))
            allegation(
                "Petitioner received a full pardon from the Governor for the offense(s) "
                f"identified above on or about {_markup(case['pardon_date'])}."
            )
            add_additional_dated_facts(case)
            allegation(
                "Accordingly, Petitioner satisfies the requirements of 22 O.S. Section 18(A)("
                f"{_markup(case['category_number'])}) with respect to "
                f"{_markup(case['criminal_case_number'])}."
            )
            story.append(Paragraph(
                f"<b>Attachment:</b><br/>Exhibit {_markup(case['exhibit_label'])} - Certificate of Pardon",
                body,
            ))

        else:
            story.append(Paragraph(
                "22 O.S. Sections 18/19 Expungement of "
                f"{_markup(case['arrest_date'])} Arrest / No File",
                section_style,
            ))
            allegation(
                f"On or about {_markup(case['arrest_date'])}, Petitioner was arrested by "
                f"{_markup(case['arresting_agency'])} for {_markup(_plain_join(case['offenses']))}."
            )
            allegation("No criminal case was filed arising from that arrest.")
            allegation(
                f"On or about {_markup(case['verification_date'])}, {_markup(case['verified_by'])} "
                f"confirmed with {_markup(case['prosecuting_agency'])} and "
                f"{_markup(case['record_agency'])} that no charge had been filed arising from the arrest."
            )
            add_additional_dated_facts(case)
            allegation(_markup(case["eligibility_basis"]) + ".")
            story.append(Paragraph(
                "22 O.S. Section 18(A) lists the categories under which a person may be eligible "
                "to have the person's record expunged. The applicable category provides, in relevant part:",
                body,
            ))
            story.append(Paragraph(_markup(case["statutory_language"]), statutory_style))
            allegation(
                "Petitioner was arrested, no charges arising from the arrest were filed, and "
                f"{_markup(case['eligibility_basis']).lower()}."
            )
            allegation(
                "Accordingly, Petitioner satisfies the requirements of 22 O.S. Section 18(A)("
                f"{_markup(case['category_number'])}) with respect to the "
                f"{_markup(case['arrest_date'])} arrest."
            )

    story.append(Paragraph("WHEREFORE", title_style))
    story.append(Paragraph(
        "<b>WHEREFORE</b>, Petitioner respectfully requests that this Court find Petitioner "
        "eligible for relief pursuant to 22 O.S. Section 18; find that the harm to Petitioner's "
        "privacy or danger of unwarranted adverse consequences outweighs the public interest in "
        "retaining the records; order the applicable records expunged pursuant to 22 O.S. Section "
        "19; and grant Petitioner all other relief to which Petitioner is entitled.",
        body,
    ))
    story.append(Spacer(1, 0.18 * inch))

    role = "Attorney for Petitioner" if data["representation"] == "counsel" else "Petitioner, Pro Se"
    signature_lines = [
        "Respectfully submitted,",
        "",
        "__________________________________",
        f"<b>{_markup(data['signer_name'])}</b>",
        _markup(role),
    ]
    if data["representation"] == "counsel":
        signature_lines.append(f"OBA No. {_markup(data['oba_number'])}")
    if data["organization"]:
        signature_lines.append(_markup(data["organization"]))
    signature_lines.extend([
        _markup(data["street_address"]),
        _markup(data["city_state_zip"]),
        f"Telephone: {_markup(data['phone'])}",
        f"Email: {_markup(data['email'])}",
    ])
    signature = Table(
        [["", Paragraph("<br/>".join(signature_lines), body)]],
        colWidths=[3.05 * inch, 3.45 * inch],
        hAlign="LEFT",
    )
    signature.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(signature)

    doc.build(story, onFirstPage=_draw_page, onLaterPages=_draw_page)
    return stream.getvalue(), data


def petition_filename(petitioner_name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9]+", "_", petitioner_name).strip("_") or "Petitioner"
    return f"{safe}_Petition_to_Expunge_DRAFT.pdf"
