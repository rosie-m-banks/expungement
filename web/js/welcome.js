document.addEventListener("DOMContentLoaded", () => {
  clearSession();

  document.getElementById("start-btn").addEventListener("click", async () => {
    showError("");
    try {
      const data = await engine.start();
      if (data.status === 'early_exit') {
        sessionStorage.setItem('early_exit_messages', JSON.stringify(data.messages));
        window.location.href = 'results.html';
      } else if (data.questions && data.filenames) {
        storeAndNavigate(data.questions, data.filenames);
      }
    } catch (err) {
      showError(String(err));
    }
  });
});


