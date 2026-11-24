// Live storage test is deliberately separate from sync history.
// A click creates at most one tiny diagnostic file, then reads it back.
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('driveDiagnosticButton');
    const status = document.getElementById('driveDiagnosticStatus');
    if (!button || !status) return;
    button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Authorizing Google Drive…';
        try {
            const auth = await chrome.identity.getAuthToken({ interactive: true });
            const token = typeof auth === 'string' ? auth : auth?.token;
            if (!token) throw Error('Google did not return an access token.');
            status.textContent = 'Saving and verifying a test-only Drive file…';
            const result = await window.CalendarBridgeStorageDiagnostic.check(fetch, token);
            status.textContent = result.state === 'created-and-verified'
                ? 'Test successful: hidden Drive file created and read back. No calendar changes.'
                : 'Test successful: existing hidden test file read and verified. No calendar changes.';
        } catch (error) {
            status.textContent = 'Drive storage test failed: ' + (error?.message || String(error));
        } finally {
            button.disabled = false;
        }
    });
});
