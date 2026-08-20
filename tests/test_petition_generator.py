import io
import re
import unittest

from pypdf import PdfReader

from petition_generator import (
    PetitionValidationError,
    generate_petition_pdf,
    petition_filename,
)


def complete_payload():
    return {
        "court_county": "Oklahoma",
        "civil_case_number": "CV-2026-100",
        "petitioner_name": "Jordan Example",
        "dob": "1985-05-12",
        "representation": "counsel",
        "signer_name": "Alex Attorney",
        "oba_number": "12345",
        "organization": "Example Legal Aid",
        "street_address": "100 Main Street",
        "city_state_zip": "Oklahoma City, OK 73102",
        "phone": "405-555-0100",
        "email": "alex@example.org",
        "cases": [
            {
                "kind": "regular",
                "county": "Oklahoma",
                "criminal_case_number": "CF-2020-100",
                "court_name": "District Court of Oklahoma County",
                "arrest_date": "2020-01-10",
                "arresting_agency": "Oklahoma City Police Department",
                "event_type": "charged",
                "offenses": "Possession of a controlled substance\nObstructing an officer",
                "disposition_date": "2021-02-15",
                "disposition": "the case was dismissed after completion of the deferred sentence",
                "additional_facts": "Petitioner completed all terms of the deferred sentence.\nNo charges are presently pending against Petitioner.",
                "category_number": "10",
                "statutory_language": "Attorney-verified statutory text for the applicable category.",
            },
            {
                "kind": "pardon",
                "county": "Oklahoma",
                "criminal_case_number": "CRF-1985-6171",
                "arrest_date": "1985-11-30",
                "arresting_agency": "Oklahoma City Police Department",
                "offenses": ["Burglary in the Second Degree"],
                "doc_number": "150974",
                "pardon_date": "2020-07-10",
                "exhibit_label": "A",
                "category_number": "4",
                "statutory_language": "Attorney-verified pardon-category text.",
            },
            {
                "kind": "no_file",
                "county": "Oklahoma",
                "arrest_date": "2017-09-01",
                "arresting_agency": "Oklahoma County Sheriff's Office",
                "offenses": ["Alleged larceny"],
                "verification_date": "2026-08-18",
                "verified_by": "Attorney for Petitioner",
                "prosecuting_agency": "Oklahoma County District Attorney",
                "record_agency": "District Court of Oklahoma County",
                "eligibility_basis": "The applicable statute of limitations has expired",
                "category_number": "5",
                "statutory_language": "Attorney-verified arrest/no-file category text.",
            },
        ],
    }


class PetitionGeneratorTests(unittest.TestCase):
    def test_multi_matter_pdf_contains_expected_sections(self):
        pdf_bytes, normalized = generate_petition_pdf(complete_payload())
        self.assertGreater(len(pdf_bytes), 5_000)
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))
        self.assertEqual(len(normalized["cases"]), 3)

        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        self.assertIn("PETITION TO EXPUNGE RECORDS", text)
        self.assertIn("JOINDER OF CLAIMS", text)
        self.assertIn("Crimes Pardoned by Governor", text)
        self.assertIn("Arrest / No File", text)
        self.assertIn("WHEREFORE", text)
        self.assertIn("DRAFT FOR ATTORNEY REVIEW", text)
        self.assertNotIn("[CATEGORY NUMBER]", text)

    def test_missing_statutory_language_is_rejected(self):
        payload = complete_payload()
        payload["cases"][0]["statutory_language"] = ""
        with self.assertRaises(PetitionValidationError) as context:
            generate_petition_pdf(payload)
        self.assertIn("attorney-verified statutory language", str(context.exception))

    def test_dismissal_fields_generate_standardized_allegation(self):
        payload = complete_payload()
        matter = payload["cases"][0]
        matter.pop("disposition_date")
        matter.pop("disposition")
        matter.update({
            "disposition_type": "dismissal",
            "dismissal_date": "2015-02-04",
            "dismissal_reason": "at the State's request.",
        })
        payload["cases"] = [matter]

        pdf_bytes, normalized = generate_petition_pdf(payload)
        text = " ".join(
            re.sub(r"\s+", " ", page.extract_text() or "").strip()
            for page in PdfReader(io.BytesIO(pdf_bytes)).pages
        )

        self.assertEqual(normalized["cases"][0]["disposition_type"], "dismissal")
        self.assertIn(
            "On or about 02/04/2015, the case was dismissed at the State's request.",
            text,
        )

    def test_conviction_fields_generate_two_allegations(self):
        payload = complete_payload()
        matter = payload["cases"][0]
        matter.pop("disposition_date")
        matter.pop("disposition")
        matter.update({
            "disposition_type": "conviction",
            "conviction_date": "2003-01-02",
            "conviction_method": "Petitioner pled",
            "sentence_description": "a one year suspended sentence.",
            "sentence_completion_date": "2004-01-02",
        })
        payload["cases"] = [matter]

        pdf_bytes, normalized = generate_petition_pdf(payload)
        text = " ".join(
            re.sub(r"\s+", " ", page.extract_text() or "").strip()
            for page in PdfReader(io.BytesIO(pdf_bytes)).pages
        )

        case = normalized["cases"][0]
        self.assertEqual(case["conviction_method"], "pled")
        self.assertEqual(case["sentence_description"], "a one year suspended sentence")
        self.assertIn(
            "On or about 01/02/2003, Petitioner pled and received a one year suspended sentence.",
            text,
        )
        self.assertIn(
            "On or about 01/02/2004, Petitioner completed the sentence.",
            text,
        )

    def test_separate_count_sentences_generate_separate_allegations(self):
        payload = complete_payload()
        matter = payload["cases"][0]
        matter.pop("disposition_date")
        matter.pop("disposition")
        matter.update({
            "disposition_type": "conviction",
            "count_sentences": [
                {
                    "count_number": 1,
                    "offense": "ignored client value",
                    "applies_to_all": False,
                    "conviction_date": "2003-01-02",
                    "conviction_method": "pled guilty",
                    "sentence_description": "a one year suspended sentence",
                    "sentence_completion_date": "2004-01-02",
                },
                {
                    "count_number": 2,
                    "offense": "ignored client value",
                    "applies_to_all": False,
                    "conviction_date": "2003-01-02",
                    "conviction_method": "pled no contest",
                    "sentence_description": "a $250 fine",
                    "sentence_completion_date": "2003-02-03",
                },
            ],
        })
        payload["cases"] = [matter]

        pdf_bytes, normalized = generate_petition_pdf(payload)
        text = " ".join(
            re.sub(r"\s+", " ", page.extract_text() or "").strip()
            for page in PdfReader(io.BytesIO(pdf_bytes)).pages
        )

        sentences = normalized["cases"][0]["count_sentences"]
        self.assertEqual([item["count_number"] for item in sentences], [1, 2])
        self.assertEqual(
            [item["offense"] for item in sentences],
            ["Possession of a controlled substance", "Obstructing an officer"],
        )
        self.assertIn(
            "On or about 01/02/2003, Petitioner pled guilty as to Count 1, "
            "Possession of a controlled substance, and received a one year suspended sentence.",
            text,
        )
        self.assertIn(
            "On or about 01/02/2004, Petitioner completed the sentence for Count 1, "
            "Possession of a controlled substance.",
            text,
        )
        self.assertIn(
            "On or about 01/02/2003, Petitioner pled no contest as to Count 2, "
            "Obstructing an officer, and received a $250 fine.",
            text,
        )
        self.assertIn(
            "On or about 02/03/2003, Petitioner completed the sentence for Count 2, "
            "Obstructing an officer.",
            text,
        )

    def test_one_shared_sentence_can_apply_to_all_counts(self):
        payload = complete_payload()
        matter = payload["cases"][0]
        matter.pop("disposition_date")
        matter.pop("disposition")
        matter.update({
            "disposition_type": "conviction",
            "count_sentences": [{
                "applies_to_all": True,
                "conviction_date": "2003-01-02",
                "conviction_method": "pled",
                "sentence_description": "a one year suspended sentence",
                "sentence_completion_date": "2004-01-02",
            }],
        })
        payload["cases"] = [matter]

        pdf_bytes, normalized = generate_petition_pdf(payload)
        text = " ".join(
            re.sub(r"\s+", " ", page.extract_text() or "").strip()
            for page in PdfReader(io.BytesIO(pdf_bytes)).pages
        )

        self.assertTrue(normalized["cases"][0]["count_sentences"][0]["applies_to_all"])
        self.assertIn(
            "On or about 01/02/2003, Petitioner pled as to all counts and received "
            "a one year suspended sentence.",
            text,
        )
        self.assertIn(
            "On or about 01/02/2004, Petitioner completed the sentence for all counts.",
            text,
        )

    def test_shared_conviction_date_groups_counts_as_subpoints(self):
        payload = complete_payload()
        matter = payload["cases"][0]
        matter.pop("disposition_date")
        matter.pop("disposition")
        matter.update({
            "disposition_type": "conviction",
            "shared_conviction_date": True,
            "count_sentences": [
                {
                    "count_number": 1,
                    "applies_to_all": False,
                    "conviction_date": "2014-12-30",
                    "conviction_method": "pled guilty",
                    "sentence_description": "a three-year deferred sentence plus costs and fines",
                    "sentence_completion_date": "2017-12-18",
                },
                {
                    "count_number": 2,
                    "applies_to_all": False,
                    "conviction_date": "2014-12-30",
                    "conviction_method": "pled no contest",
                    "sentence_description": "a one-year suspended sentence",
                    "sentence_completion_date": "2015-12-30",
                },
            ],
        })
        payload["cases"] = [matter]

        pdf_bytes, normalized = generate_petition_pdf(payload)
        text = " ".join(
            re.sub(r"\s+", " ", page.extract_text() or "").strip()
            for page in PdfReader(io.BytesIO(pdf_bytes)).pages
        )

        self.assertTrue(normalized["cases"][0]["shared_conviction_date"])
        self.assertEqual(text.count("On or about 12/30/2014"), 1)
        self.assertIn(
            "On or about 12/30/2014, Petitioner was convicted and sentenced as follows:",
            text,
        )
        self.assertIn(
            "i. Count One: Petitioner pled guilty and received a three-year deferred sentence "
            "plus costs and fines.",
            text,
        )
        self.assertIn(
            "ii. Count Two: Petitioner pled no contest and received a one-year suspended sentence.",
            text,
        )

    def test_shared_conviction_date_requires_matching_dates(self):
        payload = complete_payload()
        matter = payload["cases"][0]
        matter.pop("disposition_date")
        matter.pop("disposition")
        matter.update({
            "disposition_type": "conviction",
            "shared_conviction_date": True,
            "count_sentences": [
                {
                    "count_number": count_number,
                    "applies_to_all": False,
                    "conviction_date": conviction_date,
                    "conviction_method": "pled",
                    "sentence_description": "a one year suspended sentence",
                    "sentence_completion_date": "2004-01-02",
                }
                for count_number, conviction_date in ((1, "2003-01-02"), (2, "2003-01-03"))
            ],
        })
        payload["cases"] = [matter]

        with self.assertRaises(PetitionValidationError) as context:
            generate_petition_pdf(payload)
        self.assertIn("count conviction dates must match", str(context.exception))

    def test_count_sentences_must_cover_each_count_once(self):
        payload = complete_payload()
        matter = payload["cases"][0]
        matter.pop("disposition_date")
        matter.pop("disposition")
        repeated = {
            "count_number": 1,
            "applies_to_all": False,
            "conviction_date": "2003-01-02",
            "conviction_method": "pled",
            "sentence_description": "a one year suspended sentence",
            "sentence_completion_date": "2004-01-02",
        }
        matter.update({
            "disposition_type": "conviction",
            "count_sentences": [repeated, repeated],
        })
        payload["cases"] = [matter]

        with self.assertRaises(PetitionValidationError) as context:
            generate_petition_pdf(payload)
        self.assertIn("must include each count exactly once", str(context.exception))

    def test_felonies_render_before_misdemeanors_and_arrests(self):
        payload = complete_payload()
        regular = payload["cases"][0]
        misdemeanor = {
            **regular,
            "case_level": "misdemeanor",
            "criminal_case_number": "CM-2020-200",
        }
        felony = {
            **regular,
            "case_level": "felony",
            "criminal_case_number": "CF-2020-100",
        }
        arrest = payload["cases"][2]
        payload["cases"] = [arrest, misdemeanor, felony]

        pdf_bytes, normalized = generate_petition_pdf(payload)
        self.assertEqual(
            [matter["case_level"] for matter in normalized["cases"]],
            ["felony", "misdemeanor", "arrest"],
        )

        text = " ".join(
            re.sub(r"\s+", " ", page.extract_text() or "").strip()
            for page in PdfReader(io.BytesIO(pdf_bytes)).pages
        )
        self.assertLess(text.index("CF-2020-100"), text.index("CM-2020-200"))
        self.assertLess(text.index("CM-2020-200"), text.index("Arrest / No File"))

    def test_additional_dated_facts_generate_numbered_allegations(self):
        payload = complete_payload()
        payload["cases"] = [payload["cases"][0]]
        payload["cases"][0]["additional_dated_facts"] = [
            {
                "date": "2022-05-06",
                "info": "Petitioner completed the required treatment program.",
            },
            {
                "date": "2023-07-08",
                "info": "the court confirmed that all costs were paid",
            },
        ]

        pdf_bytes, normalized = generate_petition_pdf(payload)
        self.assertEqual(
            normalized["cases"][0]["additional_dated_facts"],
            [
                {
                    "date": "05/06/2022",
                    "info": "Petitioner completed the required treatment program",
                },
                {
                    "date": "07/08/2023",
                    "info": "the court confirmed that all costs were paid",
                },
            ],
        )

        text = " ".join(
            re.sub(r"\s+", " ", page.extract_text() or "").strip()
            for page in PdfReader(io.BytesIO(pdf_bytes)).pages
        )
        self.assertIn(
            "On or about 05/06/2022, Petitioner completed the required treatment program.",
            text,
        )
        self.assertIn(
            "On or about 07/08/2023, the court confirmed that all costs were paid.",
            text,
        )

    def test_incomplete_additional_dated_fact_is_rejected(self):
        payload = complete_payload()
        payload["cases"][0]["additional_dated_facts"] = [
            {"date": "2022-05-06", "info": ""}
        ]

        with self.assertRaises(PetitionValidationError) as context:
            generate_petition_pdf(payload)
        self.assertIn("additional dated facts entry 1 information", str(context.exception))

    def test_safe_filename(self):
        self.assertEqual(
            petition_filename("Jordan A. Example"),
            "Jordan_A_Example_Petition_to_Expunge_DRAFT.pdf",
        )


if __name__ == "__main__":
    unittest.main()
