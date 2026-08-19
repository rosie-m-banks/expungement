import unittest
from datetime import datetime
from types import SimpleNamespace

from case_classes.arrest import Arrest
from case_classes.felony import Felony
from case_classes.misdemeanor import Misdemeanor
from petition_prefill import (
    build_petition_prefill,
    eligibility_authority,
    is_eligible_verdict,
)


class PetitionPrefillTests(unittest.TestCase):
    def test_imports_only_eligible_matters_with_screening_values(self):
        felony = Felony(
            case_name="CF-2020-100",
            arresting_agency="Oklahoma City Police Department",
            arrest_date=datetime(2020, 1, 10),
            addl_arrests=[(datetime(2020, 1, 11), "Oklahoma County Sheriff's Office")],
            court="District Court of Oklahoma County",
            resolved=False,
            convic_dismiss_defer_drug=3,
            counts=[("Possession", "none"), ("Obstruction", "none")],
            sentencing_date=datetime(2021, 2, 15),
            fines_paid=True,
            expir_no_risk=False,
            treatment=True,
        )
        ineligible_misdemeanor = Misdemeanor(
            case_name="CM-2024-9",
            arresting_agency="Edmond Police Department",
            arrest_date=datetime(2024, 4, 1),
            addl_arrests=[],
            court="Oklahoma County District Court",
            resolved=False,
            convic_dismiss_defer_drug=1,
            treatment=False,
            sentencing_date=datetime(2025, 1, 1),
            fines_paid=False,
            expir_no_risk=False,
            fine_amount=700,
            imprisoned=True,
        )
        arrest = Arrest(
            case_name="2017 arrest",
            arresting_agency="Oklahoma County Sheriff's Office",
            expir_no_risk=True,
            arrest_date=datetime(2017, 9, 1),
            resolved=True,
        )
        results = [
            {
                "CF-2020-100": {"verdict": "Expungeable after required waiting period.", "details": ""},
                "CM-2024-9": {"verdict": "Not expungeable.", "details": ""},
                "2017 arrest": {"verdict": "Expungeable because of arrest no charges filed.", "details": ""},
            }
        ]

        data = build_petition_prefill(
            [ineligible_misdemeanor],
            [felony],
            [arrest],
            results,
        )

        self.assertEqual(data["screening_case_count"], 3)
        self.assertEqual(data["eligible_count"], 2)
        self.assertEqual(
            [matter["case_level"] for matter in data["cases"]],
            ["felony", "arrest"],
        )
        by_kind = {item["kind"]: item for item in data["cases"]}

        regular = by_kind["regular"]
        self.assertEqual(regular["criminal_case_number"], "CF-2020-100")
        self.assertEqual(regular["county"], "Oklahoma")
        self.assertEqual(regular["arrest_date"], "2020-01-10")
        self.assertEqual(regular["offenses"], "Possession\nObstruction")
        self.assertEqual(regular["disposition_date"], "2021-02-15")
        self.assertIn("deferred judgment expired", regular["disposition"])
        self.assertEqual(regular["resolved"], "no")
        self.assertEqual(regular["case_result"], "dismissal")
        self.assertEqual(regular["dismissal_date"], "2021-02-15")
        self.assertEqual(regular["dismissal_reason"], "after the deferred judgment expired")
        self.assertEqual(regular["additional_dated_facts"][0]["date"], "2020-01-11")
        self.assertIn(
            "also arrested by Oklahoma County Sheriff's Office",
            regular["additional_dated_facts"][0]["info"],
        )
        self.assertEqual(regular["category_number"], "")
        self.assertEqual(regular["statutory_language"], "")

        no_file = by_kind["no_file"]
        self.assertEqual(no_file["arrest_date"], "2017-09-01")
        self.assertEqual(no_file["eligibility_basis"], "")
        self.assertEqual(no_file["verification_date"], "")

    def test_eligibility_matching_excludes_negative_verdicts(self):
        self.assertTrue(is_eligible_verdict("Immediately expungeable"))
        self.assertFalse(is_eligible_verdict("Not expungeable because waiting period remains"))
        self.assertFalse(is_eligible_verdict("No result"))

    def test_supplied_verdicts_map_to_section_18_authority(self):
        examples = (
            (
                "Expungeable due to reclassification as misdemeanor, > 30 days since sentencing, "
                "fines, fees, or restitution paid, and if relevant, treatment program completed.",
                "16",
                "subsequently reclassified as a misdemeanor",
            ),
            (
                "Expungeable due to nonviolent felony criteria (no other felony convictions, "
                "no misdemeanor convictions in the last 7 years, 5 years since sentence completion, "
                "all fines paid).",
                "12",
                "separate misdemeanor in the last seven (7) years",
            ),
            (
                "Expungeable due to criteria: no counts listed in Section 13, "
                "10 years since sentence completion, all fines paid).",
                "13",
                "not more than two felony offenses",
            ),
            (
                "Expungeable. Fine < $501 and fines, fees, and restitution fully paid.",
                "10",
                "fine less than Five Hundred One Dollars ($501.00)",
            ),
            (
                "Expungeable. >= 5 years since sentencing, and fines, fees, and restitution fully paid.",
                "11",
                "end of the last misdemeanor sentence",
            ),
            (
                "Expungeable. > 1 year since dismissal and fines, fees, and restitution fully paid.",
                "8",
                "successful completion of a deferred judgment or delayed sentence",
            ),
            (
                "Expungeable. The SOL has expired, or DA has confirmed they won't refile, "
                "or case has been dismissed with paid or waived costs.",
                "7",
                "all charges have been dismissed",
            ),
            (
                "Expungeable because of arrest no charges filed.",
                "5",
                "no charges of any type",
            ),
        )

        for verdict, expected_category, language_fragment in examples:
            with self.subTest(category=expected_category):
                authority = eligibility_authority(verdict)
                self.assertIsNotNone(authority)
                self.assertEqual(authority["category_number"], expected_category)
                self.assertIn(language_fragment, authority["statutory_language"])

        self.assertIsNone(eligibility_authority("Expungeable for an unmapped reason."))

    def test_imported_matter_receives_mapped_authority(self):
        felony = SimpleNamespace(
            case_name="CF-2010-200",
            arresting_agency="Oklahoma City Police Department",
            arrest_date=datetime(2010, 1, 2),
            addl_arrests=[],
            court="District Court of Oklahoma County",
            resolved=False,
            convic_dismiss_defer_drug=1,
            counts=[("Larceny", "none")],
            sentencing_date=datetime(2015, 1, 2),
            fines_paid=True,
            treatment=False,
        )
        verdict = (
            "Expungeable due to nonviolent felony criteria (no other felony convictions, "
            "no misdemeanor convictions in the last 7 years, 5 years since sentence completion, "
            "all fines paid)."
        )

        data = build_petition_prefill([], [felony], [], [{felony.case_name: {"verdict": verdict}}])
        matter = data["cases"][0]

        self.assertEqual(matter["category_number"], "12")
        self.assertIn("nonviolent felony offense", matter["statutory_language"])
        self.assertIn("22 O.S. Section 18(A)(12)", " ".join(matter["import_notes"]))


if __name__ == "__main__":
    unittest.main()
