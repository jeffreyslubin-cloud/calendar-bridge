// Complete, read-only Google Calendar backup. No event or history writes.
// A backup is a local JSON export of calendar metadata and all non-deleted
// events, including recurring masters, with a SHA-256 integrity checksum.
(function(root){
'use strict';
const BASE='https://www.googleapis.com/calendar/v3/calendars/';
function stable(value) {
    if(Array.isArray(value))return value.map(stable);
    if(value&&typeof value==='object') {
        return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
    }
    return value;
}
async function digestHex(text,subtle) {
    if(!subtle||typeof subtle.digest!=='function')throw Error('SHA-256 unavailable');
    const bytes=new TextEncoder().encode(text);
    const hash=new Uint8Array(await subtle.digest('SHA-256',bytes));
    return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
}
function makeBackup(fetchFn,token,{subtle=globalThis.crypto?.subtle}={}) {
    if(typeof fetchFn!=='function'||!token)throw Error('Google authorization required');
    async function get(url) {
        const response=await fetchFn(url,{method:'GET',cache:'no-store',
            headers:{Authorization:'Bearer '+token}});
        if(!response?.ok)throw Error('Backup read failed, HTTP '+(response?.status||'unknown'));
        return response.json();
    }
    async function capture(calendarId) {
        if(typeof calendarId!=='string'||!calendarId.trim())
            throw Error('Select a Google calendar to back up');
        // Primary calendar can be exported for safety, but never approved for writes.
        const id=calendarId.trim();
        const path=BASE+encodeURIComponent(id);
        const metadata=await get(path+'?fields=id,summary,timeZone,accessRole,description');
        if(metadata.id!==id && id!=='primary')throw Error('Calendar identity mismatch');
        if(!metadata.id||!metadata.summary)throw Error('Incomplete calendar metadata');
        const events=[];
        const eventIds=new Set();
        let next='',pages=0;
        do {
            if(++pages>1000)throw Error('Backup exceeded 1000 pages; aborted');
            const url=new URL(path+'/events');
            url.searchParams.set('maxResults','1000');
            url.searchParams.set('singleEvents','false');
            url.searchParams.set('showDeleted','false');
            if(next)url.searchParams.set('pageToken',next);
            const data=await get(url.toString());
            if(!Array.isArray(data.items))throw Error('Google returned an incomplete event page');
            for(const event of data.items) {
                if(!event?.id||event.status==='cancelled'||eventIds.has(event.id))
                    throw Error('Invalid, cancelled or duplicate event in backup');
                eventIds.add(event.id);
                events.push(event);
            }
            next=data.nextPageToken||'';
        }while(next);
        const content={format:'calendar-bridge-backup',version:1,
            calendar:metadata,events};
        const hash=await digestHex(JSON.stringify(stable(content)),subtle);
        const envelope={...content,checksum:{algorithm:'SHA-256',value:hash}};
        // Checksum covers metadata & events, independent of object key order.
        if(await verify(envelope,subtle)!==true)
            throw Error('Local backup integrity verification failed');
        return {backup:envelope,eventCount:events.length,calendar:metadata,sha256:hash};
    }
    async function verify(file,cryptoImpl=subtle) {
        if(!file||file.format!=='calendar-bridge-backup'||file.version!==1||
            !file.calendar?.id||!Array.isArray(file.events)||
            file.checksum?.algorithm!=='SHA-256'||!file.checksum.value)
            throw Error('Invalid Calendar Bridge backup');
        const {checksum,...content}=file;
        const actual=await digestHex(JSON.stringify(stable(content)),cryptoImpl);
        if(actual!==checksum.value)throw Error('Backup checksum mismatch');
        if(new Set(file.events.map(e=>e.id)).size!==file.events.length)
            throw Error('Duplicate event IDs in backup');
        return true;
    }
    return {capture,verify};
}
const api={makeBackup};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CalendarBridgeBackup=api;
})(typeof window!=='undefined'?window:globalThis);
