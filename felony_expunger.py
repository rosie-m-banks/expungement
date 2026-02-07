from felony import Felony
from input_manager import InputManager
from datetime import datetime
from datetime import timedelta

from misdemeanor import Misdemeanor
class FelonyExpunger:
    def __init__(self, felonies: list[Felony], misdemeanors: list[Misdemeanor]):
        self.felonies = felonies
        self.misdemeanor_convictions = [convic for convic in misdemeanors if self.is_conviction(convic)]

        self.num_felony_convictions = sum(1 for convic in self.felonies if self.is_conviction(convic))
        self.inputManager = InputManager()
        self.felony_results = {}
        self.today = datetime.now()
    
    def find_resolved_cases(self):
        for i in range(len(self.felonies)):
            if i in self.felony_results:
                continue
            if self.felonies[i].resolved:
                self.felony_results[self.felonies[i].case_name] = "Immediately expungeable"
                if self.is_conviction( [i]):
                    self.num_felony_convictions -= 1

    def find_reclassified_felonies(self):
        reclassified_felonies = []
        for i in range(len(self.felonies)):
            if i in self.felony_results:
                continue
            if all(self.inputManager.check_file_contents("reclassified.txt", count) for count in self.felonies[i].counts):
                reclassified_felonies.append(i)
                if self.is_conviction( [i]):
                    self.num_felony_convictions -= 1
        
        for index in reclassified_felonies:
            case_name = self.felonies[index].case_name
            if self.today - self.felonies[index].sentencing_date < timedelta(days=30):
                self.felony_results[case_name] = "Reclassified as misdemeanor.Not expungeable due to time since sentencing < 30 days."
                continue
            if not self.felonies[index].fines_paid:
                self.felony_results[case_name] = "Reclassified as misdemeanor.Not expungeable since restitution not paid."
                continue
            if not self.felonies[index].treatment:
                self.felony_results[case_name] = "Reclassified as misdemeanor.Not expungeable since treatment not finished."
                continue
            self.felony_results[case_name] = "Expungeable due to reclassification as misdemeanor."
    
    def find_drug_dismissed_felonies(self):
        drug_dismiss = []
        for i in range(len(self.felonies)):
            if i in self.felony_results:
                continue
            if self.felonies[i].convic_dismiss_defer_drug == 4:
                drug_dismiss.append(i)
        
        for index in drug_dismiss:
            case_name = self.felonies[index].case_name
            if not self.felonies[index].treatment:
                self.felony_results[case_name] = "Not expungeable since drug program not completed."
                continue
            if not self.felonies[index].fines_paid:
                self.felony_results[case_name] = "Not expungeable since restitution not paid."
                continue
            self.felony_results[case_name] = "Expungeable due to dismissal after drug court."
    
    def expunge_felony_nonviolent(self, index):
        case_name = self.felonies[index].case_name
        if len(self.felonies[index].counts) == 1:
            if not any(self.inputManager.check_file_contents("section571.txt", count) for count in self.felonies[index].counts):
                if self.today - self.felonies[index].sentencing_date > timedelta(days=5*365):
                    if self.felonies[index].fines_paid:
                        self.felony_results[case_name] = "Expungeable due to nonviolent felony criteria (no other felony convictions, no misdemeanor convictions in the last 7 years, 5 years since sentence completion, all fines paid)."
                        return True
                    else:
                        self.felony_results[case_name] = "Not expungeable. Fines not paid." 
                else:
                    self.felony_results[case_name] = "Not expungeable. 5 year waiting period not yet reached."
            else:
                self.felony_results[case_name] = "Not expungeable. Violent felony under Section 571."
        return False
    
    def expunge_conviction_nonviolent(self, index):
        case_name = self.felonies[index].case_name
        if all(self.today - self.misdemeanor_convictions[i].sentencing_date > timedelta(days=365*7) for i in range(len(self.misdemeanor_convictions))):
            return self.expunge_felony_nonviolent(index)
        self.felony_results[case_name] = "Not expungeable. Misdemeanor convictions within the last 7 years."
        return False

    def expunge_felonies_maybe_violent(self, index):
        case_name = self.felonies[index].case_name
        if len(self.felonies[index].counts) > 2:
            self.felony_results[case_name] = "Not expungeable, too many felony counts."
            return False
        if not any(self.inputManager.check_file_contents("section13.txt", count) for count in self.felonies[index].counts) and not any(self.inputManager.check_file_contents("SORA.txt", count) for count in self.felonies[index].counts):
            if self.today - self.felonies[index].sentencing_date > timedelta(days=3650):
                if self.felonies[index].fines_paid:
                    self.felony_results[case_name] = "Expungeable due to criteria: not listed in Section 13, 10 years since sentence completion, all fines paid)."
                    return True
                else:
                    self.felony_results[case_name] = "Not expungeable. Fines not paid."
            else:
                self.felony_results[case_name] = "Not expungeable. 10 year waiting period not yet reached."
        else:
            self.felony_results[case_name] = "Not expungeable. Violent felony under Section 13.1 of Title 21 or SORA."
        return False 

    def expunge_convictions(self, index):
        result = self.expunge_conviction_nonviolent(index)
        if not result:
            return self.expunge_felonies_maybe_violent(index)
        return result
            
    def is_conviction(self, charge):
        return charge.convic_dismiss_defer_drug == 1
                

    def expunge_dismissals(self, index):
        case_name = self.felonies[index].case_name

        if self.felonies[index].convic_dismiss_defer_drug == 3:
            result = self.expunge_felony_nonviolent(index)
            if not result:
                return self.expunge_felonies_maybe_violent(index)
            return result
        
        if not self.felonies[index].expir_no_risk:
            self.felony_results[case_name] = "Not expungeable. The SOL hasn't expired, DA hasn't confirmed they won't refile, and case hasn't been dismissed with paid or waived costs."
            return False
        
        self.felony_results[case_name] = "Expungeable. The SOL has expired, or DA has confirmed they won't refile, or case has been dismissed with paid or waived costs."
        return True

    def expunger(self):
        self.find_resolved_cases()
        self.find_reclassified_felonies()
        self.find_drug_dismissed_felonies()

        if self.num_felony_convictions > 2:
            for i in range(len(self.felonies)):
                if self.felonies[i].case_name not in self.felony_results:
                    self.felony_results[self.felonies[i].case_name] = f"Not expungeable because client has {self.num_felony_convictions} felony convictions. Recommend they seek a pardon."
            return False, self.felony_results
        
        all_convictions_cleared = True

        for i in range(len(self.felonies)):
            if self.felonies[i].case_name not in self.felony_results:
                if self.is_conviction(self.felonies[i]):
                    if not self.expunge_convictions(i):
                        all_convictions_cleared = False
        
        if not all_convictions_cleared:
            for i in range(len(self.felonies)):
                if self.felonies[i].case_name not in self.felony_results:
                    self.felony_results[self.felonies[i].case_name] = f"Not expungeable because client unable to expunge all felony convictions."
            return False, self.felony_results
        
        for i in range(len(self.felonies)):
            if self.felonies[i].case_name not in self.felony_results:
                self.expunge_dismissals(i)
        
        return True, self.felony_results
        ## essentially means that all felony convictions are cleared, so misdo clearing can occur
        


