// Read-only readiness checks use mocked calendar data; no API writes.
const assert=require('assert');
const fs=require('fs'),path=require('path');
const R=require('../sync-readiness.js');
const P=require('../sync-planner.js');
const html=fs.readFileSync(path.join(__dirname,'..','popup.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'..','sync-readiness-ui.js'),'utf8');
assert(html.includes('id="syncReadinessButton"'));
for(const file of ['history-journal.js','drive-journal.js','sync-planner.js',
    'sync-readiness.js','sync-readiness-ui.js'])assert(html.includes('src="'+file+'"'));
assert(ui.includes('historyState=await store.read'));
assert(!ui.includes('store.append('));
assert(!ui.includes('insertOnce('));
const source=[{uid:'u1',summary:'ER Shift',start:'2026-12-11T21:00:00.000Z',
    end:'2026-12-12T05:00:00.000Z',location:'Hershey'}];
const parseICS=()=>source;
const response={ics:'sample-ICS',eventCount:1,skippedCount:0};
const google={backup:{calendar:{id:'work'},events:[]},calendar:{
    id:'work',summary:'Work Schedule',accessRole:'owner'
},eventCount:0};
(async()=>{
    let state={state:'uninitialized',head:null};
    let r=await R.assess({sourceResponse:response,calendarBackup:google,
        historyState:state,accountId:'acct',calendarId:'work',parseICS,planner:P});
    assert.strictEqual(r.readyForWrites,false);
    assert(r.blockers.some(x=>x.includes('first-run')));
    assert.strictEqual(r.googleCount,0);
    console.log('✓ empty calendar without history reports first-run required, never ready to write');

    const occupied={...google,backup:{calendar:{id:'work'},events:[{
        id:'old',summary:'Old shift',start:{dateTime:source[0].start},end:{dateTime:source[0].end}
    }]},eventCount:1};
    r=await R.assess({sourceResponse:response,calendarBackup:occupied,
        historyState:state,accountId:'acct',calendarId:'work',parseICS,planner:P});
    assert(r.blockers.some(x=>x.includes('not empty')));
    console.log('✓ existing Google events block automatic first run');

    state={state:'loaded',head:{fileId:'head'},history:{
        version:1,accountId:'acct',calendarId:'work',entries:{}
    }};
    r=await R.assess({sourceResponse:response,calendarBackup:google,
        historyState:state,accountId:'acct',calendarId:'work',parseICS,planner:P});
    assert.strictEqual(r.preview.add,1);
    assert.strictEqual(r.readyForWrites,false);
    assert.strictEqual(r.blockers.length,0);
    console.log('✓ valid saved history calculates candidates but enables no write');

    r=await R.assess({sourceResponse:{...response,skippedCount:2},
        calendarBackup:google,historyState:state,accountId:'acct',
        calendarId:'work',parseICS,planner:P});
    assert(r.blockers.some(x=>x.includes('omitted')));
    r=await R.assess({sourceResponse:response,calendarBackup:google,
        historyState:state,accountId:'acct',calendarId:'primary',parseICS,planner:P});
    assert(r.blockers.some(x=>x.includes('primary')));
    const changed={...state,history:{...state.history,accountId:'someone-else'}};
    r=await R.assess({sourceResponse:response,calendarBackup:google,
        historyState:changed,accountId:'acct',calendarId:'work',parseICS,planner:P});
    assert(r.blockers.some(x=>x.includes('another account')));
    console.log('✓ skipped Outlook entries, primary calendar, wrong account all block');
    console.log('All read-only readiness tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
