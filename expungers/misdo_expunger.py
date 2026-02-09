from datetime import datetime
from datetime import timedelta

import case_classes.misdemeanor as misdemeanor

class MisdoExpunger():
    def __init__(self, misdemeanors, case_results) -> None:
        self.misdemeanors = misdemeanors
        self.case_results = case_results
        self.today = datetime.today()
    
    def find_resolved_cases(self):
        for i in range(len(self.misdemeanors)):
            if i in self.case_results:
                continue
            if self.misdemeanors[i].resolved:
                self.case_results[self.misdemeanors[i].case_name] = "Immediately expungeable because case resolved by any of \nAcquittal\nReversed on appeal, dismissed by DA\nDismissed on appeal\nDNA dismissal \nFull pardon by governor \nArrest, no charges filed\nUnder 18, full pardon\nIdentity theft"

    def find_drug_dismissed_misdos(self):
        drug_dismiss = []
        for i in range(len(self.misdemeanors)):
            if i in self.case_results:
                continue
            if self.misdemeanors[i].convic_dismiss_defer_drug == 4:
                drug_dismiss.append(i)
        
        for index in drug_dismiss:
            case_name = self.misdemeanors[index].case_name
            if not self.misdemeanors[index].treatment:
                self.case_results[case_name] = "Not expungeable since drug program not completed."
                continue
            if not self.misdemeanors[index].fines_paid:
                self.case_results[case_name] = "Not expungeable since fines, fess, or restitution not paid."
                continue
            self.case_results[case_name] = "Expungeable due to dismissal after drug court, drug program completed, and fines, fees, and restitution fully paid."

    def expunge_convictions(self, index):
        case_name = self.misdemeanors[index].case_name
        if self.misdemeanors[index].fine_amount < 501 and not self.misdemeanors[index].imprisoned:
            if not self.misdemeanors[index].fines_paid:
                self.case_results[case_name] = "Not expungeable since fines, fees, or restitution not paid."
                return False
            self.case_results[case_name] = "Expungeable. Fine < $501 and fines, fees, and restitution fully paid."
            return True
        
        if self.today - self.misdemeanors[index].sentencing_date < timedelta(days=365*5):
            self.case_results[case_name] = "Not expungeable since < 5 years since end of sentence."
            return False
        if not self.misdemeanors[index].fines_paid:
            self.case_results[case_name] = "Not expungeable since fines, fees, or restitution not paid."
            return False
        self.case_results[case_name] = "Expungeable. >= 5 years since sentencing, and fines, fees, and restitution fully paid."
        return True
        

    def expunge_dismissals(self, index):
        case_name = self.misdemeanors[index].case_name

        if self.misdemeanors[index].convic_dismiss_defer_drug == 3:
            if self.today - self.misdemeanors[index].sentencing_date < timedelta(days=365):
                self.case_results[case_name] = "Not expungeable. < 1 year since dismissal."
                return False
            if not self.misdemeanors[index].fines_paid:
                self.case_results[case_name] = "Not expungeable. Fines, fees, and restitution not fully paid."
                return False
            self.case_results[case_name] = "Expungeable. > 1 year since dismissal and fines, fees, and restitution fully paid."
            return True
        
        if not self.misdemeanors[index].expir_no_risk:
            self.case_results[case_name] = "Not expungeable. The SOL hasn't expired, DA hasn't confirmed they won't refile, and case hasn't been dismissed with paid or waived costs."
            return False
        
        self.case_results[case_name] = "Expungeable. The SOL has expired, or DA has confirmed they won't refile, or case has been dismissed with paid or waived costs."
        return True

    def is_dismissal(self, index):
        param = self.misdemeanors[index].convic_dismiss_defer_drug
        return param == 2 or param == 3

    def expunger(self):
        self.find_resolved_cases()
        self.find_drug_dismissed_misdos()

        for i in range(len(self.misdemeanors)):
            if self.misdemeanors[i].case_name not in self.case_results:
                if self.is_dismissal(i):
                    self.expunge_dismissals(i)
                else:
                    self.expunge_convictions(i)

        return self.case_results
    