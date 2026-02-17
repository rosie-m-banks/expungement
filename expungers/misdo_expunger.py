from datetime import datetime
from datetime import timedelta

import case_classes.misdemeanor as Misdemeanor

class MisdoExpunger():
    def __init__(self, misdemeanors: list[Misdemeanor], case_results, can_waive_misdos) -> None:
        self.misdemeanors = misdemeanors
        self.case_results = case_results
        self.today = datetime.today()
        self.can_waive_misdos = can_waive_misdos
    
    def find_resolved_cases(self):
        for i in range(len(self.misdemeanors)):
            if i in self.case_results:
                continue
            if self.misdemeanors[i].resolved:
                self.case_results[self.misdemeanors[i].case_name] = "Immediately expungeable because case resolved by any of \nAcquittal\nReversed on appeal, dismissed by DA\nDismissed on appeal\nDNA dismissal \nFull pardon by governor\nUnder 18, full pardon\nIdentity theft"

    def find_drug_dismissed_misdos(self):
        drug_dismiss = []
        for i in range(len(self.misdemeanors)):
            if i in self.case_results:
                continue
            if self.misdemeanors[i].is_drug_dismissed():
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
        
        if not self.misdemeanors[index].fines_paid:
            self.case_results[case_name] = "Not expungeable since fines, fees, or restitution not paid."
            return False
        if self.today - self.misdemeanors[index].sentencing_date < timedelta(days=365*5):
            self.case_results[case_name] = f"Not expungeable since < 5 years since end of sentence. May be eligible after {(self.misdemeanors[index].sentencing_date + timedelta(days=365*5)).strftime("%m-%d-%Y")}."
            return False
        self.case_results[case_name] = "Expungeable. >= 5 years since sentencing, and fines, fees, and restitution fully paid."
        return True
        

    def expunge_dismissals(self, index):
        case_name = self.misdemeanors[index].case_name

        if self.misdemeanors[index].is_deferred():
            
            if not self.misdemeanors[index].fines_paid:
                self.case_results[case_name] = "Not expungeable. Fines, fees, and restitution not fully paid."
                return False
            if self.today - self.misdemeanors[index].sentencing_date < timedelta(days=365):
                self.case_results[case_name] = f"Not expungeable. < 1 year since dismissal. May be eligible after {(self.misdemeanors[index].sentencing_date + timedelta(days=365)).strftime("%m-%d-%Y")}."
                return False
            self.case_results[case_name] = "Expungeable. > 1 year since dismissal and fines, fees, and restitution fully paid."
            return True
        
        if not self.misdemeanors[index].expir_no_risk:
            self.case_results[case_name] = "Not expungeable. The SOL hasn't expired, DA hasn't confirmed they won't refile, and case hasn't been dismissed with paid or waived costs."
            return False
        
        self.case_results[case_name] = "Expungeable. The SOL has expired, or DA has confirmed they won't refile, or case has been dismissed with paid or waived costs."
        return True

    def is_dismissal(self, index):
        return self.misdemeanors[index].is_dismissed() or self.misdemeanors[index].is_deferred()

    def expunger(self):
        self.find_resolved_cases()

        if not self.can_waive_misdos:
            for i in range(len(self.misdemeanors)):
                case_name = self.misdemeanors[i].case_name
                if case_name not in self.case_results:
                    self.case_results[case_name] = "Not expungeable because of non-expungeable felony convictions."
            return self.case_results

        self.find_drug_dismissed_misdos()

        for i in range(len(self.misdemeanors)):
            if self.misdemeanors[i].case_name not in self.case_results:
                if self.is_dismissal(i):
                    self.expunge_dismissals(i)
                else:
                    self.expunge_convictions(i)

        return self.case_results
    