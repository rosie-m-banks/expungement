from case_classes.felony import Felony
from input_manager import InputManager
from datetime import datetime
from datetime import timedelta

from case_classes.misdemeanor import Misdemeanor
class FelonyExpunger:
    def __init__(self, felonies: list[Felony], misdemeanors: list[Misdemeanor], case_results: dict):
        self.felonies = felonies
        self.misdemeanor_convictions = [convic for convic in misdemeanors if convic.is_convicted()]
        self.felony_results = case_results
        self.num_felony_convictions = sum(1 for convic in self.felonies if convic.is_convicted())
        self.inputManager = InputManager()
        self.today = datetime.now()
    
    def find_resolved_cases(self):
        for i in range(len(self.felonies)):
            if i in self.felony_results:
                continue
            if self.felonies[i].resolved:
                self.felony_results[self.felonies[i].case_name] = "Immediately expungeable because case resolved by any of \nAcquittal\nReversed on appeal, dismissed by DA\nDismissed on appeal\nDNA dismissal \nFull pardon by governor\nUnder 18, full pardon\nIdentity theft"
                if self.felonies[i].is_convicted():
                    self.num_felony_convictions -= 1

    def find_reclassified_felonies(self):
        reclassified_felonies = []
        for i in range(len(self.felonies)):
            if i in self.felony_results:
                continue
            if all(self.inputManager.check_file_contents("legal_statutes/reclassified.txt", count) for count in self.felonies[i].counts):
                reclassified_felonies.append(i)
                if self.felonies[i].is_convicted():
                    self.num_felony_convictions -= 1
        
        for index in reclassified_felonies:
            case_name = self.felonies[index].case_name
            if self.today - self.felonies[index].sentencing_date < timedelta(days=30):
                self.felony_results[case_name] = "Reclassified as misdemeanor.Not expungeable due to time since sentencing < 30 days."
                continue
            if not self.felonies[index].fines_paid:
                self.felony_results[case_name] = "Reclassified as misdemeanor. Not expungeable since fines, fees, or restitution not paid."
                continue
            if not self.felonies[index].treatment:
                self.felony_results[case_name] = "Reclassified as misdemeanor. Not expungeable since treatment not finished."
                continue
            self.felony_results[case_name] = "Expungeable due to reclassification as misdemeanor, > 30 days since sentencing, \
                fines, fees, or restitution paid, and if relevant, treatment program completed."
    
    def find_drug_dismissed_felonies(self):
        drug_dismiss = []
        for i in range(len(self.felonies)):
            if i in self.felony_results:
                continue
            if self.felonies[i].is_drug_dismissed():
                drug_dismiss.append(i)
        
        for index in drug_dismiss:
            case_name = self.felonies[index].case_name
            if not self.felonies[index].treatment:
                self.felony_results[case_name] = "Not expungeable since drug program not completed."
                continue
            if not self.felonies[index].fines_paid:
                self.felony_results[case_name] = "Not expungeable since fines, fees, or restitution not paid."
                continue
            self.felony_results[case_name] = "Expungeable due to dismissal after drug court, program completed, and fines, fees, or restitution paid."
    
    def expunge_felony_nonviolent(self, index):
        case_name = self.felonies[index].case_name
        if len(self.felonies[index].counts) == 1:
            if not self.is_violent(index):
                if self.felonies[index].fines_paid:
                    if self.today - self.felonies[index].sentencing_date > timedelta(days=5*365):
                        self.felony_results[case_name] = "Expungeable due to nonviolent felony criteria (no other felony convictions, no misdemeanor convictions in the last 7 years, 5 years since sentence completion, all fines paid)."
                        return True, 0
                    else:
                        self.felony_results[case_name] = f"Not expungeable. 5 year waiting period not yet reached. Client may be eligible after {(self.felonies[index].sentencing_date + timedelta(days=365*5)).strftime("%m-%d-%Y")}"
                else:
                    self.felony_results[case_name] = "Not expungeable. Fines not paid." 
            else:
                self.felony_results[case_name] = "Not expungeable. Violent felony under Section 571."
                return False, 1
        return False, 1
    
    def expunge_conviction_nonviolent(self, index):
        case_name = self.felonies[index].case_name
        if self.num_felony_convictions > 1:
            self.felony_results[case_name] = "Not expungeable. More than one felony conviction."
            return False, 0
        if all(self.today - self.misdemeanor_convictions[i].sentencing_date > timedelta(days=365*7) for i in range(len(self.misdemeanor_convictions))):
            return self.expunge_felony_nonviolent(index)
        max_date = max([self.misdemeanor_convictions[i].sentencing_date for i in range(len(self.misdemeanor_convictions))])
        self.felony_results[case_name] = f"Not expungeable. Misdemeanor convictions within the last 7 years. Screen again after {(max_date + timedelta(365*7)).strftime("%m-%d-%Y")}."
        return False, 1

    def expunge_felonies_maybe_violent(self, index):
        case_name = self.felonies[index].case_name
        
        nottoomany = True 
        fine = False
        dat = False
        nothorrible = False
        
        if len(self.felonies[index].counts) > 2:
            nottoomany = False
        if nottoomany and not any(self.inputManager.check_file_contents("legal_statutes/section13.txt", count) for count in self.felonies[index].counts) and not any(self.inputManager.check_file_contents("legal_statutes/SORA.txt", count) for count in self.felonies[index].counts):
            nothorrible = True
        if self.felonies[index].fines_paid: 
            fine = True
        if self.today - self.felonies[index].sentencing_date > timedelta(days=3650):
            dat = True

        if fine and dat and nothorrible:
            self.felony_results[case_name] = "Expungeable due to criteria: no counts listed in Section 13, 10 years since sentence completion, all fines paid)."
            return True
        elif not fine and nothorrible:
            self.felony_results[case_name] = f"Not expungeable. After {(self.felonies[index].sentencing_date + timedelta(days=3650)).strftime("%m-%d-%Y")}, this individual may be eligible for expungement after paying their fines and fees or obtaining waiver of their fines and fees pursuant to 22 O.S. § 983.  More information about the waiver process can be found <here, https://www.oklahomafinesandfeeshelp.org/>."
        elif fine:
            self.felony_results[case_name] = f"Not expungeable. This individual may be eligible for expungement after receiving a pardon from the Governor after this date: {(self.felonies[index].sentencing_date + timedelta(days=365*5)).strftime("%m-%d-%Y")}.  More information about filing for a pardon can be found <here, https://oklahoma.gov/ppb.html>."
            if nothorrible and not dat:
                self.felony_results[case_name] += f" Alternatively, this case may be expungeable after this date: {(self.felonies[index].sentencing_date + timedelta(days=3650)).strftime("%m-%d-%Y")}"
        else:
            if not nottoomany:
                self.felony_results[case_name] = "Not expungeable. Too many felony counts."
            else:
                self.felony_results[case_name] = "Not expungeable. Violent felony under Section 13.1 of Title 21 or SORA."
             
        return False
    
    def is_violent(self, index):
        return any(self.inputManager.check_file_contents("legal_statutes/section571.txt", count) for count in self.felonies[index].counts)
                

    def expunge_convictions(self, index):
        result, num = self.expunge_conviction_nonviolent(index)
        if not result and num == 1:
            return self.expunge_felonies_maybe_violent(index)
        return result
                    

    def expunge_dismissals(self, index):
        case_name = self.felonies[index].case_name

        if self.felonies[index].is_deferred():
            result, num = self.expunge_felony_nonviolent(index)
            if not result and num == 1:
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
                if self.felonies[i].is_convicted():
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
        


