from input_manager import InputManager
from output_manager import OutputManager
from case_classes.misdemeanor import Misdemeanor
from case_classes.arrest import Arrest
from case_classes.felony import Felony

class InformationGatherer():
    def __init__(self, input_manager=None, output_manager=None):
        self.inputManager = input_manager if input_manager is not None else InputManager()
        self.outputManager = output_manager if output_manager is not None else OutputManager()
        self.num_cases = -1

    def prelim_questions(self):
        pending, out_of_state, serving, num_cases = self.inputManager.ask_questions("questions/prelim_questions.json")
        if self.inputManager.check_ans(pending):
            self.outputManager.print_out("While some records may be eligible for expungement, such as pardoned cases, many records will not be eligible due to the pending charges or unexpired deferred sentence.  Generally, it is recommended that the person wait until the pending charges are resolved or the deferred sentence has expired.")         
            return
        if self.inputManager.check_ans(out_of_state): 
            self.outputManager.print_out("While there is a process for pardon of federal crimes, there is no process for expungement. This tool is also not appropriate to analyze expungement eligibility for cases in other states. While some Oklahoma records may be expungeable, such as pardoned cases, out-of-state or federal records can complicate the expungement analysis, so this person’s record are not suitable to be analyzed by this tool.")
            return
        if self.inputManager.check_ans(serving):
            self.outputManager.print_out("While some records may be eligible for expungement, such as pardoned cases, many records will not be eligible due to the current sentence being served.  Generally, it is recommended that the person wait until completing their sentence for all cases before applying for expungement.")
            return
        self.num_cases = num_cases


    def get_misdo(self):
        case_name, arresting_agency, arrest_date, addl_arrests, court, resolved, convic_dismiss_defer_drug, treatment, \
            sentencing_date, fines_paid, expir_no_risk, fine_amount, imprisoned \
                = self.inputManager.ask_questions(["questions/shared_questions.json","questions/misdo_questions.json"])
        return Misdemeanor(resolved=resolved, convic_dismiss_defer_drug=convic_dismiss_defer_drug, treatment=treatment,
                           arresting_agency=arresting_agency, court=court,
                           sentencing_date=sentencing_date, fines_paid=fines_paid, expir_no_risk=expir_no_risk, 
                           case_name=case_name, fine_amount=fine_amount, imprisoned=imprisoned,
                           arrest_date=arrest_date, addl_arrests=addl_arrests)

    def get_felony(self):
        case_name, arresting_agency, arrest_date, addl_arrests, court, resolved, convic_dismiss_defer_drug, treatment, \
            sentencing_date, fines_paid, expir_no_risk, counts \
                = self.inputManager.ask_questions(["questions/shared_questions.json", "questions/felony_questions.json"])
        return Felony(resolved=resolved, convic_dismiss_defer_drug=convic_dismiss_defer_drug, sentencing_date=sentencing_date, 
                        fines_paid=fines_paid, counts=counts, expir_no_risk=expir_no_risk, 
                        case_name=case_name, treatment=treatment, arresting_agency=arresting_agency, court=court,
                        arrest_date=arrest_date, addl_arrests=addl_arrests)

    def get_arrest(self):
        case_name, arresting_agency, arrest_date, expir_no_risk = self.inputManager.ask_questions(["questions/arrest_questions.json"])
        return Arrest(case_name=case_name, arresting_agency=arresting_agency, expir_no_risk=expir_no_risk, arrest_date=arrest_date, resolved=True)

    def gatherInfo(self):
        self.prelim_questions()
        misdos = []
        felons = []
        arrests = []

        for i in range(self.num_cases):
            ty = self.inputManager.ask_questions(["questions/case_questions.json"])
            if ty == 0:
                felons.append(self.get_felony())
            elif ty == 1:
                misdos.append(self.get_misdo())
            elif ty == 2:
                arrests.append(self.get_arrest())
        
        return misdos, felons, arrests