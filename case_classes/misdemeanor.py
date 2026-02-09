class Misdemeanor():
    def __init__(self, case_name, arresting_agency, court, resolved, convic_dismiss_defer_drug, treatment, 
                 sentencing_date, fines_paid, expir_no_risk, fine_amount, imprisoned):
        self.resolved = resolved
        self.arresting_agency = arresting_agency
        self.court = court
        self.convic_dismiss_defer_drug = convic_dismiss_defer_drug
        self.sentencing_date = sentencing_date
        self.fines_paid = fines_paid
        self.expir_no_risk = expir_no_risk
        self.case_name = case_name
        self.fine_amount = fine_amount
        self.treatment = treatment
        self.imprisoned = imprisoned