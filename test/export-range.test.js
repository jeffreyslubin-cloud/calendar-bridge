// Run: node test/export-range.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const isolated = source.replace(
    /const calendarLiberator = new CalendarLiberator\(\);\s*$/,
    'globalThis.CalendarLiberator = CalendarLiberator;'
);
assert.notStrictEqual(source, isolated, 'unable to isolate content script');
const context = { console, Date, setTimeout, clearTimeout };
vm.runInNewContext(isolated, context);

async function run(days, failAt) {
    const exporter = Object.create(context.CalendarLiberator.prototype);
    let visited = 0, delivered = false, restored = false;
    exporter.exportDays = days;
    exporter.destination = 'download';
    exporter.allEvents = [];
    exporter.validateOutlookPage = () => true;
    exporter.showExportOverlay = () => {};
    exporter.hideExportOverlay = () => {};
    exporter.detectUserEmail = async () => null;
    exporter.sendProgress = () => {};
    exporter.saveCurrentView = async () => {};
    exporter.switchToWeeklyView = async () => {};
    exporter.navigateToToday = async () => {};
    exporter.navigatePreviousWeek = async () => {};
    exporter.navigateNextWeek = async () => {};
    exporter.collectCurrentWeekEvents = async () => {
        visited++;
        if (visited === failAt) throw new Error('Outlook navigation failed');
        exporter.allEvents.push({ title: 'test', date: new Date().toDateString() });
    };
    exporter.parseEventDate = event => new Date(event.date);
    exporter.generateICS = () => {
        exporter.lastExportCounts = { exported: exporter.allEvents.length, skipped: 0 };
        return 'BEGIN:VCALENDAR\\r\\nEND:VCALENDAR';
    };
    exporter.deliverICS = async () => {
        delivered = true;
        return { delivery: 'downloaded' };
    };
    exporter.restoreOriginalView = async () => { restored = true; };
    const result = await exporter.exportCalendar();
    return { visited, delivered, restored, result, exporter };
}

(async () => {
    for (const days of [28, 90, 180]) {
        const { visited, delivered, restored, result, exporter } = await run(days);
        const expected = Math.ceil((days + 7) / 7) + 2;
        assert.strictEqual(visited, expected, 'week scan count for ' + days);
        assert.ok(result.success && delivered && restored, 'export failed for ' + days);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const expectedEnd = new Date(today);
        expectedEnd.setDate(today.getDate() + days - 1);
        assert.strictEqual(exporter.endDate.toDateString(), expectedEnd.toDateString(), 'end date for ' + days);
        console.log('✓ ' + days + '-day range scans ' + expected + ' weeks and sets boundary');
    }
    const failure = await run(90, 3);
    assert.strictEqual(failure.result.success, false, 'failed week should fail export');
    assert.strictEqual(failure.delivered, false, 'failed week must not publish/download file');
    assert.ok(failure.restored, 'failed export should restore view');
    console.log('✓ failed week does not deliver incomplete calendar');
    console.log('All export range tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
