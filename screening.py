from gather_info import InformationGatherer
from felony_expunger import FelonyExpunger
from misdo_expunger import MisdoExpunger
from output_manager import OutputManager
from input_manager import InputManager


def gather(input_manager=None, output_manager=None):
    """Phase 1: collect all case data from the user.

    Returns (misdos, felons) lists.
    """
    ig = InformationGatherer(input_manager=input_manager, output_manager=output_manager)
    misdos, felons = ig.gatherInfo()
    return misdos, felons


def analyze(misdos, felons, output_manager=None):
    """Phase 2: run the expungement analysis and send results through
    *output_manager*.
    """
    if output_manager is None:
        output_manager = OutputManager()

    if len(misdos) == 0 and len(felons) == 0:
        return

    felonyExpunger = FelonyExpunger(felonies=felons, misdemeanors=misdos)
    can_waive_misdos, case_results = felonyExpunger.expunger()

    if not can_waive_misdos:
        for i in range(len(misdos)):
            case_results[misdos[i].case_name] = "Not expungeable because of non-expungeable felony convictions."
        output_manager.print_out(case_results)
        return

    misdoExpunger = MisdoExpunger(misdemeanors=misdos, case_results=case_results)
    case_results = misdoExpunger.expunger()

    output_manager.print_out(case_results)


def main():
    misdos, felons = gather()
    analyze(misdos, felons)


if __name__ == "__main__":
    main()
