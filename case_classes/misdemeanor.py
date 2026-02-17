class Misdemeanor():
    def __init__(self, case_name, arresting_agency, arrest_date, addl_arrests, court, resolved, convic_dismiss_defer_drug, treatment, 
                 sentencing_date, fines_paid, expir_no_risk, fine_amount, imprisoned):
        self.resolved = resolved
        self.arresting_agency = arresting_agency
        self.arrest_date = arrest_date
        self.addl_arrests = addl_arrests
        self.court = court
        self.convic_dismiss_defer_drug = convic_dismiss_defer_drug
        self.sentencing_date = sentencing_date
        self.fines_paid = fines_paid
        self.expir_no_risk = expir_no_risk
        self.case_name = case_name
        self.fine_amount = fine_amount
        self.treatment = treatment
        self.imprisoned = imprisoned
    
    
    def is_convicted(self):
        return self.convic_dismiss_defer_drug == 1
    
    
    def is_dismissed(self):
        return self.convic_dismiss_defer_drug == 2
    
    
    def is_deferred(self):
        return self.convic_dismiss_defer_drug == 3
    
    
    def is_drug_dismissed(self):
        return self.convic_dismiss_defer_drug == 4
    