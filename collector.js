/* This function is serialized by chrome.scripting: keep it self-contained. */
async function collectCourtPage(request) {
  if (location.hostname !== 'unimelb.perfectmind.com') throw new Error('The page redirected away from PerfectMind. Sign in on the official website first.');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const deadline = Date.now() + 45000;
  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const target = new Date(`${request.date}T12:00:00`);
  let scheduler, element, model, picker;
  while (Date.now() < deadline) {
    element = document.getElementById('scheduler');
    scheduler = element && window.jQuery?.(element).data('kendoScheduler');
    try {
      const ko=window.require?.defined?.('knockout')?window.require('knockout'):window.ko;
      model=ko?.dataFor(document.getElementById('facilityLandingPageModelContainer'));
      picker=window.jQuery?.('#jump-to-date').data('kendoDatePicker');
    } catch {}
    if (scheduler?.dataSource && typeof model?.loading==='function' && picker && !model.loading() && element.querySelector('.k-scheduler-header th')) break;
    if (/MemberSignIn|\/Account\/Login/i.test(location.pathname)) throw new Error('Sign-in required. Open the official login page, sign in, then try again.');
    await pause(250);
  }
  if (!scheduler?.dataSource || typeof model?.loading!=='function' || model.loading()) throw new Error('The official slots have not finished loading, or the request failed.');
  if (!picker) throw new Error('The official Jump To Date picker was not found.');
  const current = model.date();
  if (!current || dateKey(current) !== request.date) {
    picker.value(target);
    picker.trigger('change');
  }
  // PerfectMind owns the availability request. Its SchedulerDataSource has no
  // transport; read() empties the populated slots instead of refreshing them.
  const loadDeadline=Date.now()+30000;
  while(model.loading() && Date.now()<loadDeadline) await pause(250);
  if(model.loading()) throw new Error('The official availability request did not finish. Sign in, then try again.');
  if(!model.date() || dateKey(model.date())!==request.date) throw new Error('The official calendar did not switch to the requested date.');
  if(Number(model.selectedDuration?.()?.Duration)!==30) throw new Error('The official booking duration is not 30 minutes.');
  const headElements = [...element.querySelectorAll('.k-scheduler-header th')].filter(h => h.querySelector('.bm-booking-block-header-day'));
  if (!headElements.length) throw new Error('The calendar has no date columns. This cannot be treated as an empty result.');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const headers = headElements.map(h => {
    const match=h.textContent.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{1,2})/i);
    if(!match) throw new Error('Unable to parse the calendar date columns.');
    const month=months.findIndex(m=>m.toLowerCase()===match[1].toLowerCase());
    const candidates=[-1,0,1].map(offset=>new Date(target.getFullYear()+offset,month,Number(match[2]),12));
    const d=candidates.reduce((a,b)=>Math.abs(a-target)<Math.abs(b-target)?a:b);
    const r = h.getBoundingClientRect();
    return {date:dateKey(d),x:r.left+r.width/2};
  });
  if (!headers.some(h => h.date === request.date)) throw new Error('The requested date is not displayed. It may be outside the official booking window.');
  if (headers.some(h => !Number.isFinite(h.x))) throw new Error('Unable to locate the calendar date columns.');
  const visibleDates=new Set(headers.map(h=>h.date));
  const slots = [];
  const seen = new Set();
  const data=Array.from(scheduler.dataSource.data());
  for (const event of data) {
    if(event.isPlaceholder!==true || event.isDisabled) continue;
    const begin=new Date(event.start),finish=new Date(event.end);
    if(!Number.isFinite(begin.getTime())||!Number.isFinite(finish.getTime())) throw new Error('A calendar slot has an invalid start or end time.');
    const date=dateKey(begin);
    if(!visibleDates.has(date)) continue;
    const start=begin.getHours()*60+begin.getMinutes(),end=finish.getHours()*60+finish.getMinutes();
    if (end-start!==30) throw new Error('The official calendar returned a slot that is not 30 minutes long.');
    const key=`${date}|${start}`;
    if (!seen.has(key)) {seen.add(key);slots.push({date,start,end,court:request.court});}
  }
  const rendered=element.querySelectorAll('.facility-booking-slot.placeholder-event:not(.disabled-event) span[title]');
  const bookCount=Array.from(rendered).filter(s=>/Book Now/i.test(s.textContent)).length;
  if(bookCount>0 && slots.length===0) throw new Error('The website shows available slots, but parsing returned none. The result has not been marked as successful.');
  return {dates:headers.map(h=>h.date),slots,observedAt:new Date().toISOString(),diagnostics:{dataCount:data.length,visibleBookCount:bookCount,slotCount:slots.length}};
}
