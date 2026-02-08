import queue


class OutputManager():
    def __init__(self):
        self._result_queue = queue.Queue()

    def print_out(self, output):
        self._result_queue.put(output)

    def drain_results(self):
        """Return all queued results as a list (non-blocking)."""
        results = []
        while not self._result_queue.empty():
            try:
                results.append(self._result_queue.get_nowait())
            except queue.Empty:
                break
        return results
