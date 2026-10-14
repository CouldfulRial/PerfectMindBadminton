const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','booking.js'),'utf8');

async function prepare({guest=false,unavailable=false,foreign=false,request={}}={}){
  const req={facilityId:'court-a',date:'2026-10-26',start:840,duration:60,...request};
  let date=new Date('2026-10-14T00:00:00'),duration=30,pickerValue,dropdownValue,callbackArgs;
  const choices=[30,60,90,120].map(Duration=>({Duration,DurationIDs:['duration-id'],FeeType:0}));
  const data=()=>unavailable?[]:[{
    isPlaceholder:true,isDisabled:false,start:new Date('2026-10-26T14:00:00'),
    originalSlot:{Ticks:'638970660000000000',Duration:{TotalMinutes:duration}}
  }];
  const model={
    options:{facilityId:'court-a',bookingLinkCB(...args){
      callbackArgs=args;
      return `${foreign?'https://example.com':''}/32617/Clients/BookMe4EventParticipants/FacilityBooking?duration=${args[2]}&startDateTimeTicks=${args[4]}`;
    }},
    loading:()=>false,date:()=>date,durations:()=>choices,
    selectedDuration:()=>choices.find(c=>c.Duration===duration),
    selectedCalendar:()=>({Id:'calendar-id'}),selectedService:()=>({ID:'service-id'}),
    numberOfAttendees:()=>undefined,validatedNumberOfNights:()=>0,
    onBookButtonClick(){throw Error('Must not submit a reservation');},
    storeOccupancyItems(){throw Error('Must not mutate booking state');}
  };
  const scheduler={dataSource:{data}};
  const picker={options:{max:new Date('2026-11-14T00:00:00')},value(v){pickerValue=v;},trigger(){date=pickerValue;}};
  const dropdown={value(v){dropdownValue=v;},trigger(){duration=JSON.parse(dropdownValue).Duration;}};
  const widgets={'#scheduler':scheduler,'#jump-to-date':picker,'#service-duration-dropdown':dropdown};
  const context=vm.createContext({
    Date,Number,URL,Promise,Array,JSON,setTimeout,
    location:{hostname:'unimelb.perfectmind.com',origin:'https://unimelb.perfectmind.com'},
    document:{getElementById:()=>({}),querySelector:()=>guest?{href:'https://unimelb.perfectmind.com/32617/MemberRegistration/MemberSignIn?returnUrl=old'}:null},
    window:{require:Object.assign(()=>({dataFor:()=>model}),{defined:()=>true}),jQuery:selector=>({data:()=>widgets[selector]})}
  });
  vm.runInContext(source,context);
  const result=await context.prepareOfficialBooking(req);
  return {result,callbackArgs};
}

(async()=>{
  const signedIn=await prepare();
  assert.equal(signedIn.result.loginRequired,false);
  const url=new URL(signedIn.result.url);
  assert.equal(url.searchParams.get('duration'),'60');
  assert.equal(url.searchParams.get('startDateTimeTicks'),'638970660000000000','preserve opaque server ticks');
  assert.equal(signedIn.callbackArgs[0],'calendar-id');assert.equal(signedIn.callbackArgs[1],'service-id');
  assert.equal(signedIn.callbackArgs[6],1);
  const guest=await prepare({guest:true});
  assert.equal(guest.result.loginRequired,true);
  assert.equal(guest.result.url,signedIn.result.url,'navigate directly; PerfectMind handles sign-in and return routing');
  for(const duration of [30,60,90,120])assert.equal(new URL((await prepare({request:{duration}})).result.url).searchParams.get('duration'),String(duration));
  assert.match((await prepare({unavailable:true})).result.error,/no longer available/);
  assert.match((await prepare({request:{start:870}})).result.error,/no longer available/);
  assert.match((await prepare({request:{facilityId:'court-b'}})).result.error,/different court/);
  assert.match((await prepare({request:{duration:45}})).result.error,/Invalid booking/);
  assert.match((await prepare({foreign:true})).result.error,/route has changed/);
  console.log('Passed: exact court/time/duration, official callback, opaque ticks, direct booking routing for guests, unavailable slot rejection, destination validation and no reservation submission.');
})().catch(error=>{console.error(error);process.exitCode=1;});
