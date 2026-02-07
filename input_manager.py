from ast import List
from datetime import datetime

class InputManager():
    def __init__(self):
        pass

    def check_ans(self, answer):
        if 'y' in answer.lower():
            return True
        else:
            return False
    
    def check_file_contents(self, filename, match):
        with open(filename, 'r') as file:
            for line in file:
                if line == match:
                    return True
        return False
    
    def ask_questions(self, filenames: List[str]):
        ### TODO: send this info to frontend, collect and return as specified types
        pass

    def ask_question_str(self, question):
        output = str(input(question))
        return output
    
    def ask_question_int(self, question):
        output = int(input(question))
        return output
    
    def ask_question_float(self, question):
        output = float(input(question))
        return output

    def get_date_time(self, input_date):
        format_pattern = "%m-%d-%Y" # The format pattern matching the string

        datetime_object = datetime.strptime(input_date, format_pattern)
        return datetime_object


