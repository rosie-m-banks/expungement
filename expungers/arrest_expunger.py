from case_classes.arrest import Arrest

class ArrestExpunger():
    def __init__(self, arrests: list[Arrest], case_results: dict):
        self.arrests = arrests      
        self.case_results = case_results

    def expunger(self):
        for arrest in self.arrests:
            self.case_results[arrest.case_name] = "Expungeable because of arrest no charges filed"
        return self.case_results