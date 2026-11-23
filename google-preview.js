// Read-only Google Calendar preview: obtains a token, gathers the same Outlook
// ICS data as the download path, and compares it with a selected Google calendar.
// No writes, deletes, storage, or remote logging.
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('googlePreviewButton');
    const output = document.getElementById('previewResult');
    const status = document.getElementById('statusText');
    const error = document.getElementById('errorText');
    const calendarInput = document.getElementById('googleCalendarId');
    if (!button || !output || !calendarInput) return;

    function message(text, failed = false) {
        if (failed) {
            error.textContent = text;
            error.hidden = false;
            status.hidden = true;
        } else {
            status.textContent = text;
            status.hidden = false;
            error.hidden = true;
        }
    }

    function getOutlookPreview(options) {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (chrome.runtime.lastError || !tabs?.[0]?.id) {
                    reject(new Error('Could not find the active Outlook tab.'));
                    return;
                }
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'exportCalendar', destination: 'preview', ...options
                }, response => {
                    if (chrome.runtime.lastError) {
                        reject(new Error('Outlook connection failed. Refresh Outlook and try again.'));
                    } else if (!response?.success || response.delivery !== 'preview' || !response.ics) {
                        reject(new Error(response?.error || 'Outlook preview was not returned.'));
                    } else {
                        resolve(response);
                    }
                });
            });
        });
    }

    async function fetchGoogleEvents(token, calendarId, days) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const first = new Date(today);
        first.setDate(first.getDate() - 8);
        const last = new Date(today);
        last.setDate(last.getDate() + days + 2);

        const endpoint = 'https://www.googleapis.com/calendar/v3/calendars/' +
            encodeURIComponent(calendarId) + '/events';
        const items = [];
        let pageToken = '';
        // Stop and report failure rather than show misleading partial results.
        for (let page = 0; page < 20; page++) {
            const url = new URL(endpoint);
            url.searchParams.set('timeMin', first.toISOString());
            url.searchParams.set('timeMax', last.toISOString());
            url.searchParams.set('singleEvents', 'true');
            url.searchParams.set('showDeleted', 'false');
            url.searchParams.set('maxResults', '1000');
            url.searchParams.set('fields',
                'nextPageToken,items(id,iCalUID,summary,location,status,start,end,recurringEventId)');
            if (pageToken) url.searchParams.set('pageToken', pageToken);
            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(`Google Calendar returned HTTP ${response.status}. Check the calendar ID and account access.`);
            }
            const json = await response.json();
            if (!Array.isArray(json.items)) throw new Error('Google Calendar returned invalid event data.');
            items.push(...json.items);
            pageToken = json.nextPageToken || '';
            if (!pageToken) return items;
        }
        throw new Error('Too many Google events for a reliable preview. No results were used.');
    }

    function showResults(result, outlookCount, skippedCount, calendarId) {
        output.replaceChildren();
        const heading = document.createElement('strong');
        heading.textContent = 'Preview for ' + calendarId;
        output.appendChild(heading);
        const counts = [
            ['Would add', result.add.length],
            ['Would update by Outlook UID', result.update.length],
            ['Already matching', result.unchanged.length],
            ['Possible duplicates (not safe to add)', result.possibleDuplicates.length],
            ['Ambiguous matches (manual review)', result.ambiguous.length]
        ];
        const list = document.createElement('ul');
        for (const [label, count] of counts) {
            const item = document.createElement('li');
            item.textContent = label + ': ' + count;
            list.appendChild(item);
        }
        output.appendChild(list);
        const footer = document.createElement('p');
        footer.textContent = `Compared ${outlookCount} valid Outlook appointments to ${result.existingGoogle} Google events. ` +
            (skippedCount ? `WARNING: ${skippedCount} Outlook appointments were skipped. ` : '') +
            'No changes were made. Updates are candidates only, not approved changes. ' +
            'Events missing from Outlook are never marked for deletion.';
        output.appendChild(footer);

        const flagged = [...result.ambiguous, ...result.possibleDuplicates].slice(0, 8);
        if (flagged.length) {
            const labels = document.createElement('p');
            labels.textContent = 'Review examples: ' + flagged.map(item =>
                (item.event.summary || '(untitled)') + ' — ' + item.reason).join('; ');
            output.appendChild(labels);
        }
        output.hidden = false;
    }

    button.addEventListener('click', async () => {
        const calendarId = calendarInput.value.trim();
        if (!calendarId) {
            message('Enter a Google calendar ID or primary.', true);
            calendarInput.focus();
            return;
        }
        const days = Number(document.getElementById('exportDays').value);
        if (![28, 90, 180].includes(days)) {
            message('Select a valid export range.', true);
            return;
        }
        button.disabled = true;
        output.hidden = true;
        output.replaceChildren();
        try {
            // First asynchronous operation in the user gesture is authorization.
            message('Authorizing Google Calendar…');
            const auth = await chrome.identity.getAuthToken({ interactive: true });
            const token = typeof auth === 'string' ? auth : auth?.token;
            if (!token) throw new Error('Google did not return a token.');

            message('Collecting Outlook appointments…');
            const outlookResponse = await getOutlookPreview({
                timezone: document.getElementById('timezone').value,
                exportDays: days,
                calendarName: document.getElementById('calendarName').value.trim() || null,
                includeDeclined: document.getElementById('includeDeclined').checked,
                includeOOO: document.getElementById('includeOOO').checked
            });
            const outlook = window.CalendarBridgePreview.parseICS(outlookResponse.ics);
            if (outlook.length !== outlookResponse.eventCount || outlook.length === 0) {
                throw new Error('Outlook event count mismatch; preview cancelled.');
            }

            message('Reading Google calendar events…');
            const google = await fetchGoogleEvents(token, calendarId, days);
            const compared = window.CalendarBridgePreview.compare(outlook, google);
            showResults(compared, outlook.length, outlookResponse.skippedCount || 0, calendarId);
            message('Read-only preview completed. No events were changed.');
        } catch (e) {
            message('Preview failed: ' + (e?.message || String(e)), true);
        } finally {
            button.disabled = false;
        }
    });
});
