from gather_info import InformationGatherer
from expungers.felony_expunger import FelonyExpunger
from expungers.misdo_expunger import MisdoExpunger
from output_manager import OutputManager
from expungers.arrest_expunger import ArrestExpunger

def gather(input_manager=None, output_manager=None):
    """Phase 1: collect all case data from the user.

    Returns (misdos, felons) lists.
    """
    ig = InformationGatherer(input_manager=input_manager, output_manager=output_manager)
    misdos, felons, arrests = ig.gatherInfo()
    return misdos, felons, arrests


def analyze(misdos, felons, arrests, output_manager=None):
    """Phase 2: run the expungement analysis and send results through
    *output_manager*.
    """
    if output_manager is None:
        output_manager = OutputManager()

    if len(misdos) == 0 and len(felons) == 0 and len(arrests) == 0:
        return
    
    case_results = {}

    arrestExpunger = ArrestExpunger(arrests=arrests, case_results=case_results)
    case_results = arrestExpunger.expunger()

    felonyExpunger = FelonyExpunger(felonies=felons, misdemeanors=misdos, case_results=case_results)
    can_waive_misdos, case_results = felonyExpunger.expunger()

    misdoExpunger = MisdoExpunger(misdemeanors=misdos, case_results=case_results, can_waive_misdos=can_waive_misdos)
    case_results = misdoExpunger.expunger()

    overall_results = {}
    for case in arrests + felons + misdos:
        details = build_details(case)
        overall_results[case.case_name] = {
            "verdict": case_results.get(case.case_name, "No result"),
            "details": details,
        }

    output_manager.print_out(overall_results)
    output_manager.print_out("Cosine similarity used for Section 571, Section 13, and SORA classification. Use with discretion.")


def build_details(case):
    """Build a human-readable details string from whatever attributes the case has."""
    lines = []
    if hasattr(case, "arresting_agency"):
        lines.append(f"Arresting agency: {case.arresting_agency}")
    if hasattr(case, "court"):
        lines.append(f"Court: {case.court}")
    if hasattr(case, "arrest_date"):
        lines.append(f"Arrest date: {case.arrest_date.strftime('%m-%d-%Y') if hasattr(case.arrest_date, 'strftime') else case.arrest_date}")
    if hasattr(case, "addl_arrests") and len(case.addl_arrests) > 0:
        lines.append(f"Additional arrest dates: {[i.strftime('%m-%d-%Y') if hasattr(i, 'strftime') else i for i in case.addl_arrests]}")
    if hasattr(case, "sentencing_date") and case.sentencing_date is not None:
        lines.append(f"Sentencing date: {case.sentencing_date.strftime('%m-%d-%Y') if hasattr(case.sentencing_date, 'strftime') else case.sentencing_date}")
    if hasattr(case, "counts"):
        lines.append(f"Charges: {', '.join(case.counts)}")
    if hasattr(case, "fine_amount"):
        lines.append(f"Fine amount: ${case.fine_amount}")
    return "\n".join(lines)


def main():
    misdos, felons, arrests = gather()
    analyze(misdos, felons, arrests)


if __name__ == "__main__":
    main()
