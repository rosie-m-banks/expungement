from case_classes.arrest import Arrest

class ArrestExpunger():
    def __init__(self, arrests: list[Arrest], case_results: dict):
        self.arrests = arrests      
        self.case_results = case_results

    def expunger(self):
        for arrest in self.arrests:
            if arrest.expir_no_risk:
                self.case_results[arrest.case_name] = "Expungeable because of arrest no charges filed. "
            else:
                self.case_results[arrest.case_name] = "Not expungeable because SOL not expired and prosecutor did not confirm in writing that no charges will be filed. "    
        return self.case_results