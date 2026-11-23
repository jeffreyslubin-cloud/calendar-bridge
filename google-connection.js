// Google Calendar OAuth connection test. Never writes calendar events or stores tokens.
// Interactive authorization must run directly from a user's button click.
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('googleConnectButton');
    const status = document.getElementById('googleConnectStatus');
    if (!button || !status) return;

    button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Waiting for Google authorization…';

        try {
            const auth = await chrome.identity.getAuthToken({ interactive: true });
            const token = typeof auth === 'string' ? auth : auth?.token;
            if (!token) throw new Error('Google did not provide an access token.');

            // Read one record from the primary calendar, verifying actual Calendar API
            // access while deliberately fetching no event details and making no writes.
            status.textContent = 'Checking Google Calendar access…';
            const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=kind';
            const response = await fetch(url, {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store'
            });
            if (!response.ok) {
                // Do not render the body: it can contain sensitive account information.
                throw new Error(`Google Calendar returned HTTP ${response.status}.`);
            }

            status.textContent = 'Connected! Calendar access verified. No events were changed.';
            button.textContent = 'Check Google connection again';
        } catch (error) {
            status.textContent = `Connection failed: ${error?.message || String(error)}`;
        } finally {
            button.disabled = false;
        }
    });
});
