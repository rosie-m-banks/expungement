class Felony():
    def __init__(self, case_name, resolved, convic_dismiss_defer_drug, 
                 counts, sentencing_date, fines_paid, expir_no_risk, treatment):
        self.resolved = resolved
        self.convic_dismiss_defer_drug = convic_dismiss_defer_drug
        self.counts = counts
        self.sentencing_date = sentencing_date
        self.fines_paid = fines_paid
        self.expir_no_risk = expir_no_risk
        self.case_name = case_name
        self.treatment = treatment
        