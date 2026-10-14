const COURTS = [
  {letter:'A',name:'East A',id:'5dd9d9de-c567-472f-8f92-c0b0040fce0b'},
  {letter:'B',name:'East B',id:'4f41d717-8114-4c10-a1ab-2fcbab4c0b73'},
  {letter:'C',name:'East C',id:'fbed3549-8020-44ae-ba4b-99263eabcca5'},
  {letter:'D',name:'East D',id:'2697bcf7-ff43-4770-a02e-77f3dafe230e'},
  {letter:'E',name:'West E',id:'6b7062e5-30e7-437b-a0d8-5f7fa8957889'},
  {letter:'F',name:'West F',id:'2d88ff48-0c7a-45e9-ad68-7b2f5d99aa0f'},
  {letter:'G',name:'West G',id:'4a1cefdc-7fc6-434b-b1cc-aef762116251'},
  {letter:'H',name:'West H',id:'30d9b4e5-7053-4c66-ae12-2ba86a46bad8'}
];
const PARALLEL_COURTS=COURTS.length;
const shownCourts=new Set(COURTS.map(c=>c.letter));
const courtStates=new Map();
const $ = id => document.getElementById(id);
const extension = Boolean(globalThis.chrome?.runtime?.id && chrome.scripting);
let snapshot = null, running = false, stopped = false, bookingBusy = false;
let selection=null;
const workerTabs=new Set();
let persistQueue=Promise.resolve();
const escapeHtml = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeText = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const minutes = s => Number(s.split(':')[0])*60+Number(s.split(':')[1]);
function addDays(key,n) {const d=new Date(`${key}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function datesBetween(from,to) {const dates=[];for(let d=from;d<=to;d=addDays(d,1))dates.push(d);return dates;}
function melbourneToday() {const p=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const v=t=>p.find(x=>x.type===t).value;return `${v('year')}-${v('month')}-${v('day')}`;}
function melbourneMidnight(key) {
  const [y,m,d]=key.split('-').map(Number);const wall=Date.UTC(y,m-1,d);let utc=wall;
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){const parts=formatter.formatToParts(new Date(utc));const v=t=>Number(parts.find(p=>p.type===t).value);const rendered=Date.UTC(v('year'),v('month')-1,v('day'),v('hour'),v('minute'),v('second'));utc-=rendered-wall;}
  return new Date(utc).toISOString();
}
function facilityUrl(court,date) {
  const url=new URL('https://unimelb.perfectmind.com/32617/Clients/BookMe4LandingPages/Facility');
  url.search=new URLSearchParams({facilityId:court.id,widgetId:'15f6af07-39c5-473e-b053-96653f77a406',calendarId:'bce15730-1f38-4e5c-889c-856322a7f877',arrivalDate:melbourneMidnight(date)}).toString();return url.href;
}
function badge(c,decorative=false) {return `<span class="court court-${c.letter.toLowerCase()}" title="${c.name}" ${decorative?'aria-hidden="true"':`aria-label="${c.name}"`}>${c.letter}</span>`;}
function durationFits(index,coverage,date,start,duration,limit) {
  if(start+duration>limit) return false;
  for(let t=start;t<start+duration;t+=30) {
    const courts=index.get(`${date}|${t}`);
    if(!courts || !Array.from(courts).some(court=>coverage[court]?.[date])) return false;
  }
  return true;
}
function availabilityIndex(data,visible=shownCourts){
  const index=new Map();
  for(const s of data.slots){if(!visible.has(s.court))continue;const key=`${s.date}|${s.start}`;if(!index.has(key))index.set(key,new Set());index.get(key).add(s.court);}
  return index;
}
function buildBookingPlan(slots){
  const plan=[];
  for(const slot of slots){
    const last=plan.at(-1);
    if(last&&last.court===slot.court&&last.date===slot.date&&last.start+last.duration===slot.start)last.duration+=30;
    else plan.push({court:slot.court,date:slot.date,start:slot.start,duration:30});
  }
  return plan;
}
function slotChoiceState(court,date,start){
  const picked=selection?.slots.findIndex(s=>s.court===court&&s.date===date&&s.start===start)??-1;
  const next=selection?selection.start+selection.slots.length*30:null;
  const enabled=!running&&!bookingBusy&&!selection?.opened&&picked<0&&(!selection||(date===selection.date&&start===next&&selection.slots.length*30<selection.duration));
  return {picked:picked>=0,initial:picked===0,enabled};
}
function slotLink(c,date,time,duration,bookingLinks=true) {
  const state=bookingLinks?slotChoiceState(c.letter,date,time):{enabled:true,picked:false,initial:false};
  const action=bookingLinks?(state.picked?'Selected 30-minute session':state.enabled?'Select this 30-minute session':'Not selectable now'):'Open official timetable';
  const label=`${c.name} · ${date} ${timeText(time)}–${timeText(time+30)} · ${action}`;
  const classes=`${state.picked?' slot-picked':''}${state.initial?' slot-initial':''}${!state.enabled&&!state.picked?' slot-locked':''}`;
  return `<a class="court court-${c.letter.toLowerCase()} court-link${classes}" href="${escapeHtml(facilityUrl(c,date))}" target="_blank" rel="noopener" data-court="${c.letter}" data-date="${date}" data-start="${time}"${!state.enabled?' aria-disabled="true" tabindex="-1"':''} title="${label}" aria-label="${label}">${c.letter}</a>`;
}
function legendHtml(courts=COURTS) {return courts.map(c=>`<li>${badge(c)}<span>${c.name}</span></li>`).join('');}
function courtStatusText(letter){return courtStates.get(letter)?.text||'Waiting';}
function renderCourtControls(){
  $('court-progress').innerHTML=COURTS.map(c=>{
    const shown=shownCourts.has(c.letter),status=courtStates.get(c.letter)||{state:'pending',text:'Waiting'};
    return `<li><button id="toggle-${c.letter}" class="court-toggle" type="button" data-court="${c.letter}" aria-pressed="${shown}" aria-controls="result" title="${shown?'Hide':'Show'} ${c.name} · ${escapeHtml(status.text)}"${bookingBusy?' disabled':''}>${badge(c,true)}<span class="court-toggle-info"><span class="court-toggle-name">${c.name}${shown?'':'<span class="court-visibility">Hidden</span>'}</span><span id="progress-${c.letter}" class="court-toggle-status" data-state="${status.state}" title="${escapeHtml(status.text)}">${escapeHtml(courtStatusText(c.letter))}</span></span></button></li>`;
  }).join('');
}
function setCourtState(letter,state,text) {
  courtStates.set(letter,{state,text});const status=$(`progress-${letter}`);
  status.dataset.state=state;status.textContent=courtStatusText(letter);status.title=text;
  const court=COURTS.find(c=>c.letter===letter);$(`toggle-${letter}`).title=`${shownCourts.has(letter)?'Hide':'Show'} ${court.name} · ${text}`;
}
function resetProgress(){for(const c of COURTS)courtStates.set(c.letter,{state:'pending',text:'Waiting'});renderCourtControls();}
function restoreProgress(data){
  const dates=datesBetween(data.query.from,data.query.to);
  for(const c of COURTS){
    if(dates.every(d=>data.coverage[c.letter]?.[d]))setCourtState(c.letter,'ok',`Done · ${data.slots.filter(s=>s.court===c.letter).length} slots`);
    else {const error=data.errors?.find(e=>e.court===c.name);setCourtState(c.letter,error?'error':'pending',error?.message||'Not checked');}
  }
}
function toggleCourt(letter){
  if(bookingBusy||!COURTS.some(c=>c.letter===letter))return;
  // Changing the eligible courts clears the previous plan before another
  // session can be selected or prepared for booking.
  preserveTimetablePosition(()=>{
    if(shownCourts.has(letter))shownCourts.delete(letter);else shownCourts.add(letter);
    selection=null;renderCourtControls();$('legend').innerHTML=legendHtml(COURTS.filter(c=>shownCourts.has(c.letter)));
  });
  setNotice();render();$(`toggle-${letter}`).focus?.({preventScroll:true});
}
function renderTable(data,hideEmpty=true,duration=60,bookingLinks=true,visible=shownCourts) {
  const dates=datesBetween(data.query.from,data.query.to), start=minutes(data.query.timeFrom),end=minutes(data.query.timeTo);
  const index=availabilityIndex(data,visible),courts=COURTS.filter(c=>visible.has(c.letter));
  const week=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dateLabel=new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',timeZone:'UTC'});
  const headers=dates.map(d=>`<th scope="col">${dateLabel.format(new Date(d+'T12:00:00Z'))}<span class="weekday">${week[new Date(d+'T12:00:00Z').getUTCDay()]}</span></th>`).join('');
  const rows=[];
  for(let t=start;t<end;t+=30){
    let availableCount=0,unknownCount=0;
    const cells=dates.map(d=>{
      const available=index.get(`${d}|${t}`)||new Set();
      const badges=courts.filter(c=>available.has(c.letter)).map(c=>slotLink(c,d,t,duration,bookingLinks)).join('');availableCount+=available.size;
      const fits=durationFits(index,data.coverage,d,t,duration,end);
      const missing=courts.filter(c=>!data.coverage[c.letter]?.[d]);unknownCount+=missing.length;
      const unknown=missing.length?`<span class="unknown" title="${missing.map(c=>c.name).join(', ')} not checked successfully">? ${missing.map(c=>c.letter).join('')}</span>`:'';
      let attrs=fits?` class="duration-match" title="Courts available for ${duration} consecutive minutes from ${timeText(t)}; switching courts is allowed"`:'';
      if(bookingLinks&&selection){
        const picked=selection.slots.some(s=>s.date===d&&s.start===t);
        const next=!bookingBusy&&!selection.opened&&selection.slots.length*30<selection.duration&&d===selection.date&&t===selection.start+selection.slots.length*30;
        attrs=` class="${picked?(t===selection.start?'selection-initial':'selection-picked'):next?'selection-next':'selection-muted'}"`;
      }
      return `<td${attrs}>${badges?`<div class="slots">${badges}</div>`:unknown?'':'<span class="dash">—</span>'}${unknown}</td>`;
    }).join('');
    if(!hideEmpty||availableCount||unknownCount)rows.push(`<tr><th scope="row">${timeText(t)}–${timeText(t+30)}</th>${cells}</tr>`);
  }
  const captured=new Date(data.updatedAt).toLocaleString('en-AU',{timeZone:'Australia/Melbourne',hour12:false});
  const incomplete=courts.some(c=>dates.some(d=>!data.coverage[c.letter]?.[d]));
  const empty=!courts.length?(bookingLinks?'All courts are hidden. Click a court button to show its sessions.':'All courts were hidden when this timetable was exported.'):(bookingLinks?'No visible court sessions in this range. Show more courts or change your filters.':'No sessions for the displayed courts in this range.');
  return `<p class="snapshot">${data.query.from} to ${data.query.to} · Last checked: ${escapeHtml(captured)} (Melbourne) · Showing ${courts.length}/8 courts${incomplete?' · Some visible courts have not been checked successfully':''}</p><div class="table-wrap" role="region" aria-label="Availability timetable; scroll horizontally to view all dates" tabindex="0"><table><thead><tr><th scope="col">Time slot</th>${headers}</tr></thead><tbody>${courts.length&&rows.length?rows.join(''):`<tr><td class="empty" colspan="${dates.length+1}">${empty}</td></tr>`}</tbody></table></div>`;
}
function selectedDuration(){const value=Number($('duration').value);return [30,60,90,120].includes(value)?value:60;}
function renderSelection(){
  $('selection-panel').hidden=!selection;
  if(!selection)return;
  const total=selection.slots.length*30;
  $('selection-title').textContent=`${total} / ${selection.duration} minutes selected · ${selection.date}`;
  $('selected-sessions').innerHTML=selection.slots.map(s=>{const court=COURTS.find(c=>c.letter===s.court);return `<span class="selected-session">${badge(court)}<span>${timeText(s.start)}–${timeText(s.start+30)}</span></span>`;}).join('');
  $('selection-message').textContent=bookingBusy?'Rechecking your selected sessions and opening the official booking pages. Please wait.':selection.opened?`Opened ${selection.openCount} booking page(s). Complete the orders on PerfectMind.${selection.failure?' '+selection.failure:''}`:selection.failure?selection.failure:`Choose a court for the next half-hour: ${timeText(selection.start+total)}–${timeText(selection.start+total+30)}. Other dates and times are greyed out.`;
  $('undo-selection').disabled=bookingBusy||selection.opened;
  $('reset-selection').disabled=bookingBusy;
  $('retry-booking').hidden=!(total===selection.duration&&!bookingBusy&&!selection.opened&&selection.failure);
}
function preserveTimetablePosition(update) {
  // Anchor the existing table in the viewport before feedback above it changes.
  // Keep its horizontal position too: rebuilding the grid otherwise resets it.
  const result=$('result'), previous=result.querySelector?.('.table-wrap');
  const anchor=previous?{top:previous.getBoundingClientRect().top,left:previous.scrollLeft}:null;
  update();
  const current=result.querySelector?.('.table-wrap');
  if(anchor&&current){
    current.scrollLeft=anchor.left;
    const shift=current.getBoundingClientRect().top-anchor.top;
    if(shift)window.scrollBy(0,shift);
  }
}
function setNotice(message='') {
  preserveTimetablePosition(()=>{$('notice').hidden=!message;$('notice').textContent=message;});
}
function render() {
  const result=$('result'),focused=document.activeElement?.closest?.('a.court-link');
  const focusKey=focused?.dataset;
  preserveTimetablePosition(()=>{
    renderSelection();
    if(snapshot)result.innerHTML=renderTable(snapshot,$('hide-empty').checked,selectedDuration());
  });
  if(snapshot){
    if(focusKey){
      const replacement=Array.from(result.querySelectorAll('a.court-link')).find(link=>link.dataset.court===focusKey.court&&link.dataset.date===focusKey.date&&link.dataset.start===focusKey.start);
      replacement?.focus({preventScroll:true});
    }
    $('export').disabled=false;$('json').disabled=false;
  }
}
function resetSelection(){if(bookingBusy)return;selection=null;setNotice();render();}
function undoSelection(){if(!selection||bookingBusy||selection.opened)return;selection.slots.pop();selection.failure=null;if(!selection.slots.length)selection=null;render();}
function addSession(court,date,start){
  if(!snapshot||running||bookingBusy||selection?.opened)throw new Error('Wait for checking to finish, or reset your previous selection.');
  const index=availabilityIndex(snapshot);
  if(!snapshot.coverage[court]?.[date]||!index.get(`${date}|${start}`)?.has(court))throw new Error('This session has not been confirmed available.');
  if(!selection){
    const duration=selectedDuration();
    if(!durationFits(index,snapshot.coverage,date,start,duration,minutes(snapshot.query.timeTo)))throw new Error('There are not enough consecutive available sessions from this time for the selected Duration. Choose a highlighted cell or a shorter Duration.');
    selection={date,start,duration,slots:[],opened:false,failure:null,openCount:0};
  }
  if(date!==selection.date||start!==selection.start+selection.slots.length*30||selection.slots.length*30>=selection.duration)throw new Error('Choose one court in the next consecutive half-hour on the selected date.');
  selection.slots.push({court,date,start,end:start+30});selection.failure=null;
  return selection.slots.length*30===selection.duration;
}
async function waitForTab(id,ignoreStop=false) {
  for(let i=0;i<90;i++) {if(stopped&&!ignoreStop)throw new Error('Stopped');const tab=await chrome.tabs.get(id);if(tab.status==='complete')return;await new Promise(r=>setTimeout(r,500));}
  throw new Error('The official page took too long to load');
}
async function persist(){
  if(!extension)return;
  const saved=structuredClone(snapshot);
  persistQueue=persistQueue.catch(()=>{}).then(()=>chrome.storage.local.set({snapshot:saved}));
  await persistQueue;
}
function setCheckingLoader(visible,parallel){
  $('checking-loader').hidden=!visible;
  if(visible)$('checking-message').textContent=`${parallel>1?`Multiple background tabs (up to ${parallel} at once) will open`:'A background tab will open'} to check the courts. Please wait and keep this panel open. The tabs will close automatically.`;
}
async function runCourtPool(items,limit,task,shouldStop){
  let next=0;
  return Promise.allSettled(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(!shouldStop() && next<items.length){const item=items[next++];await task(item);}
  }));
}
async function closeWorkerTab(id){
  if(!workerTabs.delete(id))return;
  try{await chrome.tabs.remove(id);}catch{}
}
function requestStop(){
  stopped=true;$('status').textContent='Stopping… Results already retrieved will be kept.';
  Promise.allSettled(Array.from(workerTabs,closeWorkerTab));
}
async function start(event){
  event.preventDefault();if(running||bookingBusy)return;
  const query={from:$('from').value,to:$('to').value,timeFrom:$('time-from').value,timeTo:$('time-to').value,parallelCourts:PARALLEL_COURTS};
  if(query.from>query.to||minutes(query.timeFrom)>=minutes(query.timeTo)||minutes(query.timeFrom)%30||minutes(query.timeTo)%30){$('status').textContent='Check the date order and use start and end times on 30-minute boundaries.';return;}
  if(datesBetween(query.from,query.to).length>42){$('status').textContent='You can check up to 42 days at once. Choose a shorter date range.';return;}
  if(!extension){setNotice('Load this project as an Edge extension, then click its icon to open the panel. Opening the HTML file directly does not grant access to the official website.');return;}
  const startedAt=Date.now();
  stopped=false;running=true;selection=null;$('start').disabled=true;$('stop').disabled=false;setNotice();resetProgress();
  setCheckingLoader(true,query.parallelCourts);
  snapshot={version:2,timeZone:'Australia/Melbourne',query,slots:[],coverage:{},diagnostics:[],errors:[],updatedAt:new Date().toISOString()};render();
  let active=0,finished=0;
  const updateProgress=()=>{if(!stopped)$('status').textContent=`Checking in background · ${active} active · ${finished}/8 courts finished (${query.parallelCourts} at a time)`;};
  try {
    const panel=await chrome.tabs.getCurrent();
    if(!Number.isInteger(panel?.windowId))throw new Error('Unable to identify this panel window. Reopen the extension panel and try again.');
    const workers=await runCourtPool(COURTS,query.parallelCourts,async court=>{
      snapshot.coverage[court.letter]={};let cursor=query.from,tabId=null;
      active++;updateProgress();setCourtState(court.letter,'loading',`Loading ${cursor}`);
      try {
        const tab=await chrome.tabs.create({url:facilityUrl(court,cursor),windowId:panel.windowId,active:false});
        tabId=tab.id;workerTabs.add(tabId);
        while(cursor<=query.to&&!stopped){
          setCourtState(court.letter,'loading',`Loading ${cursor}`);
          if(cursor!==query.from)await chrome.tabs.update(tabId,{url:facilityUrl(court,cursor)});
          await waitForTab(tabId);if(stopped)break;
          const results=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:collectCourtPage,args:[{date:cursor,court:court.letter}]});
          if(stopped)break;
          const page=results[0]?.result;if(page?.error)throw new Error(page.error);if(!page?.dates?.includes(cursor))throw new Error('The requested date was not returned');
          snapshot.diagnostics.push({court:court.name,date:cursor,...page.diagnostics});
          for(const d of page.dates)if(d>=query.from&&d<=query.to)snapshot.coverage[court.letter][d]=page.observedAt;
          snapshot.slots.push(...page.slots.filter(s=>s.date>=query.from&&s.date<=query.to));
          snapshot.updatedAt=new Date().toISOString();await persist();render();
          const last=page.dates.slice().sort().at(-1);const next=addDays(last,1);if(next<=cursor)throw new Error('The calendar did not advance to the next dates');cursor=next;
        }
        const count=snapshot.slots.filter(s=>s.court===court.letter).length;
        setCourtState(court.letter,stopped?'pending':'ok',stopped?'Stopped':`Done · ${count} slots`);
      } catch(error){
        if(stopped)setCourtState(court.letter,'pending','Stopped');
        else {snapshot.errors.push({court:court.name,date:cursor,message:error.message});setCourtState(court.letter,'error',error.message);await persist();render();}
      } finally {
        if(tabId!==null)await closeWorkerTab(tabId);
        active--;finished++;updateProgress();
      }
    },()=>stopped);
    const rejected=workers.find(worker=>worker.status==='rejected');
    if(rejected)throw rejected.reason;
  } catch(error){setNotice(error.message);}
  finally {
    await Promise.allSettled(Array.from(workerTabs,closeWorkerTab));
    running=false;$('start').disabled=false;$('stop').disabled=true;
    setCheckingLoader(false);
    const dates=datesBetween(query.from,query.to);const complete=COURTS.filter(c=>dates.every(d=>snapshot.coverage[c.letter]?.[d])).length;
    const elapsedMs=Date.now()-startedAt;
    snapshot.timing={elapsedMs,parallelCourts:query.parallelCourts};
    $('status').textContent=stopped?`Stopped. Results retrieved so far are saved (${complete}/8 courts complete).`:`Finished: ${complete}/8 courts checked successfully in ${(elapsedMs/1000).toFixed(1)}s (${query.parallelCourts} at a time).${complete<8?' Failed courts show ?. Sign in on the official website, then try again.':''}`;
    snapshot.updatedAt=new Date().toISOString();await persist();render();
  }
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportHtml(){
  const css=await(await fetch('style.css')).text();
  const duration=selectedDuration();
  const body=`<main><header><h1>Badminton Availability</h1><p class="sub">University of Melbourne · 30-minute slots · Melbourne local time</p></header><p class="duration-note">Highlighted cells have an available court for every 30-minute slot over the next ${duration} minutes, within the displayed range. Switching courts is allowed. Click a court to open its official timetable. Direct booking-page navigation is available in the extension panel.</p><ul id="legend">${legendHtml(COURTS.filter(c=>shownCourts.has(c.letter)))}</ul>${renderTable(snapshot,$('hide-empty').checked,duration,false)}<footer>— = no available visible courts; ? = not checked successfully. Results are a snapshot; confirm availability on the official website.</footer></main>`;
  download(`badminton-${snapshot.query.from}-${snapshot.query.to}.html`,`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Badminton Timetable</title><style>${css}</style></head><body>${body}</body></html>`,'text/html;charset=utf-8');
}
async function init(){
  const today=melbourneToday();$('from').value=today;$('to').value=addDays(today,6);$('duration').value='60';$('hide-empty').checked=true;$('legend').innerHTML=legendHtml();resetProgress();
  renderSelection();
  if(extension){const saved=await chrome.storage.local.get('snapshot');if(saved.snapshot?.version===2){snapshot=saved.snapshot;restoreProgress(snapshot);for(const [id,key] of [['from','from'],['to','to'],['time-from','timeFrom'],['time-to','timeTo']])$(id).value=snapshot.query[key];$('status').textContent='Restored your last availability snapshot. Click Check availability to refresh.';render();}else if(saved.snapshot){await chrome.storage.local.remove('snapshot');$('status').textContent='Cleared an older snapshot that may contain incorrect empty results. Please check availability again.';}}
  else{setNotice('This is the local extension panel. Follow the README to load it into Edge, then open it using the extension icon.');}
}
async function openSelectedBookings(){
  if(!selection||bookingBusy||selection.opened||selection.slots.length*30!==selection.duration)return;
  const current=selection,plan=buildBookingPlan(current.slots),pending=new Set(),opened=[];
  bookingBusy=true;renderCourtControls();current.failure=null;$('start').disabled=true;$('duration').disabled=true;setNotice();render();
  try{
    const panel=await chrome.tabs.getCurrent();
    if(!Number.isInteger(panel?.windowId))throw new Error('Reopen the extension panel and try again.');
    const checks=await Promise.allSettled(plan.map(async segment=>{
      const court=COURTS.find(c=>c.letter===segment.court);
      const tab=await chrome.tabs.create({url:facilityUrl(court,segment.date),windowId:panel.windowId,active:false});pending.add(tab.id);
      await waitForTab(tab.id,true);
      const results=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:prepareOfficialBooking,args:[{facilityId:court.id,date:segment.date,start:segment.start,duration:segment.duration}]});
      const result=results[0]?.result;
      if(result?.error)throw new Error(`${court.name} ${timeText(segment.start)}: ${result.error}`);
      if(!result?.url)throw new Error(`${court.name}: unable to prepare the booking page.`);
      const target=new URL(result.url);
      if(target.origin!=='https://unimelb.perfectmind.com'||!/^\/32617\/Clients\/BookMe4EventParticipants\/FacilityBooking\/?$/.test(target.pathname))throw new Error('The booking destination could not be verified.');
      return {tabId:tab.id,url:target.href};
    }));
    const failure=checks.find(check=>check.status==='rejected');
    if(failure)throw failure.reason;
    for(const check of checks){
      await chrome.tabs.update(check.value.tabId,{url:check.value.url,active:false});
      pending.delete(check.value.tabId);opened.push(check.value.tabId);
    }
    current.opened=true;current.openCount=opened.length;
    setNotice(`Opened ${opened.length} official booking page(s). PerfectMind will prompt for login if needed. Review the sessions and complete each order there.`);
  }catch(error){
    current.failure=error.message||'Unable to open the selected booking pages.';
    current.openCount=opened.length;current.opened=opened.length>0;
    setNotice(`${opened.length?`${opened.length} page(s) opened. `:'No booking pages were opened. '}${current.failure}`);
  }finally{
    await Promise.allSettled(Array.from(pending,id=>chrome.tabs.remove(id)));
    bookingBusy=false;renderCourtControls();$('start').disabled=running;$('duration').disabled=false;render();
    if(opened.length)await chrome.tabs.update(opened[0],{active:true}).catch(()=>{});
  }
}
function onSlotClick(event){
  const link=event.target.closest('a.court-link');if(!link||!extension)return;
  if(link.getAttribute('aria-disabled')==='true'){event.preventDefault();return;}
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();const court=COURTS.find(c=>c.letter===link.dataset.court),date=link.dataset.date,start=Number(link.dataset.start);
  if(!court||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isInteger(start)||start<0||start>=1440||start%30)return;
  try{const ready=addSession(court.letter,date,start);setNotice();render();if(ready)openSelectedBookings();}
  catch(error){setNotice(error.message);}
}
$('duration').addEventListener('change',resetSelection);
$('undo-selection').addEventListener('click',undoSelection);
$('reset-selection').addEventListener('click',resetSelection);
$('retry-booking').addEventListener('click',openSelectedBookings);
$('result').addEventListener('click',onSlotClick);
$('court-progress').addEventListener('click',event=>{const button=event.target.closest('button.court-toggle');if(button)toggleCourt(button.dataset.court);});
$('query').addEventListener('submit',start);$('stop').addEventListener('click',requestStop);$('hide-empty').addEventListener('change',render);$('export').addEventListener('click',()=>exportHtml().catch(e=>{$('status').textContent=`Export failed: ${e.message}`;}));$('json').addEventListener('click',()=>download('badminton-availability.json',JSON.stringify(snapshot,null,2),'application/json'));
window.addEventListener('beforeunload',event=>{if(running||bookingBusy){event.preventDefault();event.returnValue='';}});
init().catch(e=>{$('status').textContent=`Initialisation failed: ${e.message}`;});
