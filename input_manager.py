import json
import os
import queue
from datetime import datetime
from legal_statutes.embeddings import GetCosineSimilarity

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class InputManager():
    def __init__(self):
        self._question_queue = queue.Queue()
        self._answer_queue = queue.Queue()
        self.files = {}

    def check_ans(self, answer):
        if isinstance(answer, bool):
            return answer
        if 'y' in answer.lower():
            return True
        return False

    def check_file_contents(self, filename, query):
        filepath = os.path.join(BASE_DIR, filename) if not os.path.isabs(filename) else filename
        if filepath not in self.files:
            similarity_engine = GetCosineSimilarity()
            similarity_engine.embed_file(filepath)
            self.files[filepath] = similarity_engine
        cosine_checker = self.files[filepath]
        match = None
        try:
            match = cosine_checker.get_matching_crime(query)
        except Exception as e:
            print(f"Error when getting querying gemini, {e}. Defaulting to None, will need attorney review")
        print (match)
        return match != None

    def ask_questions(self, filenames):
        """Read question JSON file(s), enqueue for the web frontend, block until
        decoded answers arrive, and return them as a tuple (or single value)."""
        if isinstance(filenames, str):
            filenames = [filenames]

        questions = []
        for fn in filenames:
            filepath = os.path.join(BASE_DIR, fn) if not os.path.isabs(fn) else fn
            with open(filepath, 'r') as f:
                data = json.load(f)
                for key in sorted(data.keys(), key=lambda k: int(k[1:])):
                    questions.append(data[key])

        # Enqueue questions with source filenames for the web server
        self._question_queue.put({"filenames": filenames, "questions": questions})

        # Block until decoded answers arrive from the web server
        answers = self._answer_queue.get()

        if len(answers) == 1:
            return answers[0]
        return tuple(answers)

    # -- helpers used by the web server --

    def get_pending_questions(self):
        """Non-blocking: return the next question batch or None."""
        try:
            return self._question_queue.get_nowait()
        except queue.Empty:
            return None

    def provide_answers(self, answers):
        """Push decoded answers so ask_questions() can unblock."""
        self._answer_queue.put(answers)

    def get_date_time(self, input_date):
        format_pattern = "%m-%d-%Y"
        datetime_object = datetime.strptime(input_date, format_pattern)
        return datetime_object
