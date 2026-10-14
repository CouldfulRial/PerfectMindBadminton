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
const $ = id => document.getElementById(id);
const extension = Boolean(globalThis.chrome?.runtime?.id && chrome.scripting);
let snapshot = null, running = false, stopped = false;
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
function badge(c) {return `<span class="court court-${c.letter.toLowerCase()}" title="${c.name}" aria-label="${c.name}">${c.letter}</span>`;}
function durationFits(index,coverage,date,start,duration,limit) {
  if(start+duration>limit) return false;
  for(let t=start;t<start+duration;t+=30) {
    const courts=index.get(`${date}|${t}`);
    if(!courts || !Array.from(courts).some(court=>coverage[court]?.[date])) return false;
  }
  return true;
}
function slotLink(c,date,time) {
  const label=`${c.name} · ${date} ${timeText(time)} · Open official timetable`;
  return `<a class="court court-${c.letter.toLowerCase()} court-link" href="${escapeHtml(facilityUrl(c,date))}" target="_blank" rel="noopener" data-court="${c.letter}" data-date="${date}" title="${label}" aria-label="${label}">${c.letter}</a>`;
}
function legendHtml() {return COURTS.map(c=>`<li>${badge(c)}<span>${c.name}</span></li>`).join('');}
function setCourtState(letter,state,text) {const li=$(`progress-${letter}`);li.dataset.state=state;li.textContent=`${COURTS.find(c=>c.letter===letter).name} · ${text}`;}
function resetProgress(){ $('court-progress').innerHTML=COURTS.map(c=>`<li id="progress-${c.letter}" data-state="pending">${c.name} · Waiting</li>`).join(''); }
function renderTable(data,hideEmpty=true,duration=60) {
  const dates=datesBetween(data.query.from,data.query.to), start=minutes(data.query.timeFrom),end=minutes(data.query.timeTo);
  const index=new Map();
  for(const s of data.slots){const key=`${s.date}|${s.start}`;if(!index.has(key))index.set(key,new Set());index.get(key).add(s.court);}
  const week=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dateLabel=new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',timeZone:'UTC'});
  const headers=dates.map(d=>`<th scope="col">${dateLabel.format(new Date(d+'T12:00:00Z'))}<span class="weekday">${week[new Date(d+'T12:00:00Z').getUTCDay()]}</span></th>`).join('');
  const rows=[];
  for(let t=start;t<end;t+=30){
    let availableCount=0,unknownCount=0;
    const cells=dates.map(d=>{
      const available=index.get(`${d}|${t}`)||new Set();
      const badges=COURTS.filter(c=>available.has(c.letter)).map(c=>slotLink(c,d,t)).join('');availableCount+=available.size;
      const fits=durationFits(index,data.coverage,d,t,duration,end);
      const missing=COURTS.filter(c=>!data.coverage[c.letter]?.[d]);unknownCount+=missing.length;
      const unknown=missing.length?`<span class="unknown" title="${missing.map(c=>c.name).join(', ')} not checked successfully">? ${missing.map(c=>c.letter).join('')}</span>`:'';
      return `<td${fits?` class="duration-match" title="Courts available for ${duration} consecutive minutes from ${timeText(t)}; switching courts is allowed"`:''}>${badges?`<div class="slots">${badges}</div>`:unknown?'':'<span class="dash">—</span>'}${unknown}</td>`;
    }).join('');
    if(!hideEmpty||availableCount||unknownCount)rows.push(`<tr><th scope="row">${timeText(t)}–${timeText(t+30)}</th>${cells}</tr>`);
  }
  const captured=new Date(data.updatedAt).toLocaleString('en-AU',{timeZone:'Australia/Melbourne',hour12:false});
  const incomplete=COURTS.some(c=>dates.some(d=>!data.coverage[c.letter]?.[d]));
  return `<p class="snapshot">${data.query.from} to ${data.query.to} · Last checked: ${escapeHtml(captured)} (Melbourne)${incomplete?' · Some courts have not been checked successfully':''}</p><div class="table-wrap" role="region" aria-label="Availability timetable; scroll horizontally to view all dates" tabindex="0"><table><thead><tr><th scope="col">Time slot</th>${headers}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function selectedDuration(){const value=Number($('duration').value);return [30,60,90,120].includes(value)?value:60;}
function render() {if(snapshot){$('result').innerHTML=renderTable(snapshot,$('hide-empty').checked,selectedDuration());$('export').disabled=false;$('json').disabled=false;}}
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
function selectedParallel(){const n=Number($('parallel').value);return [1,2,4,8].includes(n)?n:4;}
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
  event.preventDefault();if(running)return;
  const query={from:$('from').value,to:$('to').value,timeFrom:$('time-from').value,timeTo:$('time-to').value,parallelCourts:selectedParallel()};
  if(query.from>query.to||minutes(query.timeFrom)>=minutes(query.timeTo)||minutes(query.timeFrom)%30||minutes(query.timeTo)%30){$('status').textContent='Check the date order and use start and end times on 30-minute boundaries.';return;}
  if(datesBetween(query.from,query.to).length>42){$('status').textContent='You can check up to 42 days at once. Choose a shorter date range.';return;}
  if(!extension){$('notice').hidden=false;$('notice').textContent='Load this project as an Edge extension, then click its icon to open the panel. Opening the HTML file directly does not grant access to the official website.';return;}
  const startedAt=Date.now();
  stopped=false;running=true;$('start').disabled=true;$('stop').disabled=false;$('parallel').disabled=true;$('notice').hidden=true;resetProgress();
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
          const page=results[0]?.result;if(!page?.dates?.includes(cursor))throw new Error('The requested date was not returned');
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
  } catch(error){$('notice').hidden=false;$('notice').textContent=error.message;}
  finally {
    await Promise.allSettled(Array.from(workerTabs,closeWorkerTab));
    running=false;$('start').disabled=false;$('stop').disabled=true;$('parallel').disabled=false;
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
  const body=`<main><header><h1>Badminton Availability</h1><p class="sub">University of Melbourne · 30-minute slots · Melbourne local time</p></header><p class="duration-note">Highlighted cells have an available court for every 30-minute slot over the next ${duration} minutes, within the displayed range. Switching courts is allowed. Click a court to open its official timetable. Automatic date navigation is available in the extension panel.</p><ul id="legend">${legendHtml()}</ul>${renderTable(snapshot,$('hide-empty').checked,duration)}<footer>— = no available courts; ? = not checked successfully. Results are a snapshot; confirm availability on the official website.</footer></main>`;
  download(`badminton-${snapshot.query.from}-${snapshot.query.to}.html`,`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Badminton Timetable</title><style>${css}</style></head><body>${body}</body></html>`,'text/html;charset=utf-8');
}
async function init(){
  const today=melbourneToday();$('from').value=today;$('to').value=addDays(today,6);$('parallel').value='4';$('duration').value='60';$('hide-empty').checked=true;$('legend').innerHTML=legendHtml();resetProgress();
  if(extension){const saved=await chrome.storage.local.get('snapshot');if(saved.snapshot?.version===2){snapshot=saved.snapshot;for(const [id,key] of [['from','from'],['to','to'],['time-from','timeFrom'],['time-to','timeTo']])$(id).value=snapshot.query[key];$('status').textContent='Restored your last availability snapshot. Click Check availability to refresh.';render();}else if(saved.snapshot){await chrome.storage.local.remove('snapshot');$('status').textContent='Cleared an older snapshot that may contain incorrect empty results. Please check availability again.';}}
  else{$('notice').hidden=false;$('notice').textContent='This is the local extension panel. Follow the README to load it into Edge, then open it using the extension icon.';}
}
// Only navigates the official date picker; does not select a slot or reserve.
async function showOfficialDate(date) {
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    const picker=window.jQuery?.('#jump-to-date').data('kendoDatePicker');
    let model;
    try {const ko=window.require?.defined?.('knockout')?window.require('knockout'):window.ko;model=ko?.dataFor(document.getElementById('facilityLandingPageModelContainer'));}catch{}
    if(picker && typeof model?.loading==='function' && !model.loading()){
      const target=new Date(date+'T00:00:00');
      if(picker.options.max && target>new Date(picker.options.max))throw new Error('The date is outside the official booking window');
      picker.value(target);picker.trigger('change');
      document.getElementById('scheduler')?.scrollIntoView({block:'center'});
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Date navigation timed out. Use Jump To Date on the official website');
}
async function onSlotClick(event){
  const link=event.target.closest('a.court-link');if(!link||!extension||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();const court=COURTS.find(c=>c.letter===link.dataset.court);const date=link.dataset.date;
  if(!court||!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  try{
    const tab=await chrome.tabs.create({url:facilityUrl(court,date),active:true});
    await waitForTab(tab.id,true);
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:showOfficialDate,args:[date]});
  }catch(error){$('status').textContent=`The official page opened, but date navigation failed: ${error.message}. Use Jump To Date on the official website.`;}
}
$('duration').addEventListener('change',render);
$('result').addEventListener('click',onSlotClick);
$('query').addEventListener('submit',start);$('stop').addEventListener('click',requestStop);$('hide-empty').addEventListener('change',render);$('export').addEventListener('click',()=>exportHtml().catch(e=>{$('status').textContent=`Export failed: ${e.message}`;}));$('json').addEventListener('click',()=>download('badminton-availability.json',JSON.stringify(snapshot,null,2),'application/json'));
window.addEventListener('beforeunload',event=>{if(running){event.preventDefault();event.returnValue='';}});
init().catch(e=>{$('status').textContent=`Initialisation failed: ${e.message}`;});
