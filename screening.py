from gather_info import InformationGatherer
from felony_expunger import FelonyExpunger
from misdo_expunger import MisdoExpunger
from output_manager import OutputManager

def main():
    informationGatherer = InformationGatherer()
    outputManager = OutputManager()

    misdos, felons = informationGatherer.gatherInfo()

    if len(misdos) == 0 and len(felons) == 0:
        return
    
    felonyExpunger = FelonyExpunger(felonies=felons, misdemeanors=misdos)

    can_waive_misdos, case_results = felonyExpunger.expunger()

    if not can_waive_misdos:
        for i in range(len(misdos)):
            case_results[misdos[i].case_name] = "Not expungeable because of non-expungeable felony convictions."
        outputManager.print_out(case_results)
        return
    
    misdoExpunger = MisdoExpunger(misdemeanors=misdos, case_results=case_results)
    case_results = misdoExpunger.expunger()

    outputManager.print_out(case_results)




if __name__ == "__main__":
    main()