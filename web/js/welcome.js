document.addEventListener("DOMContentLoaded", () => {
  // Clear any stale session on landing
  clearSession();

  document.getElementById("start-btn").addEventListener("click", async () => {
    showError("");
    try {
      const data = await postJson("/api/start");
      setSessionId(data.session_id);

      if (data.questions && data.filenames) {
        storeAndNavigate(data.questions, data.filenames);
      } else {
        // Questions not ready yet — poll until they are
        pollAndNavigate();
      }
    } catch (err) {
      showError(String(err));
    }
  });
});

