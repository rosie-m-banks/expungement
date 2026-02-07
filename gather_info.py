from input_manager import InputManager
from output_manager import OutputManager
from misdemeanor import Misdemeanor
from felony import Felony

class InformationGatherer():
    def __init__(self):
        self.inputManager = InputManager()
        self.outputManager = OutputManager()
        self.num_cases = -1

    def prelim_questions(self):
        pending, out_of_state, serving, num_cases = self.inputManager.ask_questions("prelim_questions.json")
        if self.inputManager.check_ans(pending) or self.inputManager.check_ans(out_of_state) or self.inputManager.check_ans(serving):
            self.outputManager.print_out("This client is not eligible for expungement.")
            return
        self.num_cases = num_cases


    def get_misdo(self):
        case_name, resolved, convic_dismiss_defer_drug, treatment, \
            sentencing_date, fines_paid, expir_no_risk, fine_amount, imprisoned \
                = self.inputManager.ask_questions(["shared_questions.json","misdo_questions.json"])
        return Misdemeanor(resolved=resolved, convic_dismiss_defer_drug=convic_dismiss_defer_drug, treatment=treatment,
                           sentencing_date=sentencing_date, fines_paid=fines_paid, expir_no_risk=expir_no_risk, 
                           case_name=case_name, fine_amount=fine_amount, imprisoned=imprisoned)

    def get_felony(self):
        case_name, resolved, convic_dismiss_defer_drug, treatment, \
            sentencing_date, fines_paid, expir_no_risk, counts \
                = self.inputManager.ask_questions(["shared_questions.json", "felony_questions.json"])
        return Felony(resolved=resolved, convic_dismiss_defer_drug=convic_dismiss_defer_drug, sentencing_date=sentencing_date, fines_paid=fines_paid, counts=counts, expir_no_risk=expir_no_risk, case_name=case_name, treatment=treatment)

    def gatherInfo(self):
        self.prelim_questions()
        misdos = []
        felons = []

        for i in range(self.num_cases):
            ty = self.inputManager.ask_questions(["case_questions.json"])
            if ty == 0:
                felons.append(self.get_felony())
            else:
                misdos.append(self.get_misdo())
        
        return misdos, felons