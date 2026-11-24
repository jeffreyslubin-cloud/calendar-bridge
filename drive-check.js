// User-initiated, read-only verification of Google Drive's hidden appDataFolder.
// Does not create, update, delete, download, or expose the contents of history.
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('driveCheckButton');
    const status = document.getElementById('driveCheckStatus');
    if (!button || !status) return;

    button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Authorizing hidden Google Drive storage…';
        try {
            // Authorization must be requested directly from a user gesture.
            const auth = await chrome.identity.getAuthToken({ interactive: true });
            const token = typeof auth === 'string' ? auth : auth?.token;
            if (!token) throw new Error('Google did not provide an access token.');

            status.textContent = 'Checking Drive app storage…';
            const store = window.CalendarBridgeDriveHistory.makeStore(fetch, token);
            const file = await store.find(); // GET-only; no history initialization
            if (file) {
                status.textContent = 'Connected to Drive. Existing history file found; no changes made.';
            } else {
                status.textContent = 'Connected to Drive. No history file yet (expected); no changes made.';
            }
        } catch (error) {
            status.textContent = 'Drive check failed: ' + (error?.message || String(error));
        } finally {
            button.disabled = false;
        }
    });
});
