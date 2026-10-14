// Executed inside the official page. Builds its own booking-form URL without
// submitting a reservation, storing occupancies, accepting terms or paying.
async function prepareOfficialBooking(request) {
  try {
  if(location.hostname!=='unimelb.perfectmind.com')throw new Error('The official page redirected. Open PerfectMind and sign in first.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(request.date)||!Number.isInteger(request.start)||request.start<0||request.start>=1440||request.start%30||![30,60,90,120].includes(request.duration))throw new Error('Invalid booking date, time or duration.');
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const key=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  let model,scheduler,picker;
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    try{
      const ko=window.require?.defined?.('knockout')?window.require('knockout'):window.ko;
      model=ko?.dataFor(document.getElementById('facilityLandingPageModelContainer'));
      scheduler=window.jQuery?.('#scheduler').data('kendoScheduler');
      picker=window.jQuery?.('#jump-to-date').data('kendoDatePicker');
    }catch{}
    if(model && scheduler && picker && typeof model.loading==='function' && !model.loading())break;
    await pause(250);
  }
  if(!model||!scheduler||!picker||model.loading())throw new Error('The official booking calendar did not finish loading.');
  if(model.options?.facilityId!==request.facilityId)throw new Error('The official page is for a different court.');
  const waitLoaded=async()=>{
    const until=Date.now()+30000;
    while(model.loading()&&Date.now()<until)await pause(250);
    if(model.loading())throw new Error('The official availability request did not finish.');
  };
  if(!model.date()||key(model.date())!==request.date){
    const date=new Date(request.date+'T00:00:00');
    if(picker.options.max && date>new Date(picker.options.max))throw new Error('The date is outside the official booking window.');
    picker.value(date);picker.trigger('change');await waitLoaded();
  }
  const choice=Array.from(model.durations()).find(item=>Number(item.Duration)===request.duration);
  if(!choice)throw new Error('The selected duration is not offered for this court.');
  if(Number(model.selectedDuration().Duration)!==request.duration){
    const durationPicker=window.jQuery('#service-duration-dropdown').data('kendoDropDownList');
    if(!durationPicker)throw new Error('The official duration control was not found.');
    durationPicker.value(JSON.stringify({DurationID:choice.DurationIDs[0],Duration:choice.Duration}));
    durationPicker.trigger('change');await waitLoaded();
  }
  if(key(model.date())!==request.date||Number(model.selectedDuration().Duration)!==request.duration)throw new Error('The official date or duration did not update correctly.');
  const event=Array.from(scheduler.dataSource.data()).find(item=>{
    if(item.isPlaceholder!==true||item.isDisabled)return false;
    const date=new Date(item.start);
    return key(date)===request.date && date.getHours()*60+date.getMinutes()===request.start;
  });
  const slot=event?.originalSlot;
  if(!slot||Number(slot.Duration?.TotalMinutes)!==request.duration)throw new Error('This selected session is no longer available for this court. Check availability again or change the selected sessions.');
  if(slot.Ticks===undefined||slot.Ticks===null||typeof model.options.bookingLinkCB!=='function')throw new Error('The official booking link is unavailable. Use the official timetable.');
  // The same callback and arguments used by PerfectMind's goToBookingPage.
  const href=model.options.bookingLinkCB(
    model.selectedCalendar().Id,model.selectedService().ID,
    slot.Duration.TotalMinutes,model.selectedDuration().DurationIDs,slot.Ticks,
    model.numberOfAttendees(),model.validatedNumberOfNights()+1,model.selectedDuration().FeeType
  );
  const booking=new URL(href,location.origin);
  if(booking.origin!==location.origin||!/^\/32617\/Clients\/BookMe4EventParticipants\/FacilityBooking\/?$/.test(booking.pathname))throw new Error('The official booking route has changed. Use the official timetable.');
  const loginLink=document.querySelector('a.pm-login-button[href*="MemberSignIn"]');
  // Navigate to the booking route directly. PerfectMind owns the sign-in
  // redirect and return destination, including any attendee-selection step.
  return {url:booking.href,loginRequired:Boolean(loginLink)};
  } catch(error) { return {error:error?.message||'Unable to prepare the official booking page.'}; }
}
