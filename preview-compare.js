// Conservative, read-only Outlook ICS versus Google Calendar comparison.
// No Chrome or DOM dependencies so it can be tested with Node.
(function (root) {
    'use strict';

    function unescapeText(value) {
        return (value || '').replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');
    }
    function toDateTime(value, isDateOnly) {
        if (!value) return null;
        if (isDateOnly) {
            if (!/^\d{8}$/.test(value)) return null;
            return value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8);
        }
        if (!/^\d{8}T\d{6}Z$/.test(value)) return null;
        const iso = value.slice(0, 4) + '-' + value.slice(4, 6) + '-' +
            value.slice(6, 8) + 'T' + value.slice(9, 11) + ':' +
            value.slice(11, 13) + ':' + value.slice(13, 15) + 'Z';
        return Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
    }
    function parseICS(ics) {
        if (typeof ics !== 'string') throw new Error('Outlook preview returned no calendar data.');
        const lines = ics.replace(/\r\n/g, '\n').split('\n');
        const unfolded = [];
        for (const line of lines) {
            if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
            else unfolded.push(line);
        }
        const events = [];
        let current = null;
        for (const line of unfolded) {
            if (line === 'BEGIN:VEVENT') { current = {}; continue; }
            if (line === 'END:VEVENT') {
                if (!current || !current.uid || !current.start || !current.end) {
                    throw new Error('An Outlook event is incomplete; preview stopped.');
                }
                events.push(current);
                current = null;
                continue;
            }
            if (!current) continue;
            const sep = line.indexOf(':');
            if (sep < 0) continue;
            const key = line.slice(0, sep).toUpperCase();
            const value = line.slice(sep + 1);
            const name = key.split(';')[0];
            if (name === 'UID') current.uid = value;
            if (name === 'SUMMARY') current.summary = unescapeText(value);
            if (name === 'LOCATION') current.location = unescapeText(value);
            if (name === 'DTSTART') current.start = toDateTime(value, key.includes('VALUE=DATE'));
            if (name === 'DTEND') current.end = toDateTime(value, key.includes('VALUE=DATE'));
        }
        return events;
    }
    function normalize(value) { return (value || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
    function googleValue(dateTime) {
        if (!dateTime) return null;
        if (dateTime.date) return dateTime.date;
        if (!dateTime.dateTime || !Number.isFinite(Date.parse(dateTime.dateTime))) return null;
        return new Date(dateTime.dateTime).toISOString();
    }
    function signature(e) {
        return normalize(e.summary) + '|' + e.start + '|' + e.end;
    }
    function looksSame(a, b) {
        return signature(a) === signature(b) &&
            normalize(a.location) === normalize(b.location);
    }
    function normalizedGoogle(g) {
        return { uid: g.iCalUID || null, summary: g.summary || '',
            location: g.location || '', start: googleValue(g.start),
            end: googleValue(g.end), id: g.id || null, recurring: !!g.recurringEventId };
    }
    function compare(outlook, google) {
        if (!Array.isArray(outlook) || !Array.isArray(google)) throw new Error('Invalid comparison inputs.');
        const gs = google.filter(g => g.status !== 'cancelled').map(normalizedGoogle);
        const byUid = new Map(), bySignature = new Map(), sourceCounts = new Map();
        for (const e of outlook) {
            if (!e.uid || !e.start || !e.end) throw new Error('Outlook data incomplete.');
            sourceCounts.set(e.uid, (sourceCounts.get(e.uid) || 0) + 1);
        }
        for (const g of gs) {
            if (g.uid) {
                if (!byUid.has(g.uid)) byUid.set(g.uid, []);
                byUid.get(g.uid).push(g);
            }
            if (!bySignature.has(signature(g))) bySignature.set(signature(g), []);
            bySignature.get(signature(g)).push(g);
        }
        const result = { add: [], update: [], unchanged: [], possibleDuplicates: [], ambiguous: [],
            existingGoogle: gs.length };
        for (const e of outlook) {
            if (sourceCounts.get(e.uid) !== 1) {
                result.ambiguous.push({ event: e, reason: 'Repeated Outlook UID' });
                continue;
            }
            const matched = byUid.get(e.uid) || [];
            if (matched.length > 1) {
                // Recurrent instances can share iCalUID: never guess which instance to change.
                result.ambiguous.push({ event: e, reason: 'Multiple Google events share this UID' });
            } else if (matched.length === 1) {
                if (looksSame(e, matched[0])) result.unchanged.push({ event: e });
                else result.update.push({ event: e, googleId: matched[0].id });
            } else if ((bySignature.get(signature(e)) || []).length) {
                result.possibleDuplicates.push({ event: e, reason: 'Same title and time but different UID' });
            } else {
                result.add.push({ event: e });
            }
        }
        return result;
    }
    const api = { parseICS, compare };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.CalendarBridgePreview = api;
})(typeof window !== 'undefined' ? window : globalThis);
