const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
async function collect({initialDuration=60,missingDuration=false}={}){
  let duration=initialDuration,dropdownValue;
  const head={textContent:'Mon Oct 26',querySelector:()=>({}),getBoundingClientRect:()=>({left:0,width:100})};
  const element={querySelector:()=>head,querySelectorAll:selector=>selector.includes('header')?[head]:[{textContent:'Book Now'}]};
  const model={loading:()=>false,date:()=>new Date('2026-10-26T00:00:00'),selectedDuration:()=>({Duration:duration}),durations:()=>missingDuration?[]:[{Duration:30,DurationIDs:['half-hour']}]};
  const scheduler={dataSource:{data:()=>[{isPlaceholder:true,start:new Date('2026-10-26T14:00:00'),end:new Date('2026-10-26T14:30:00')}],read(){throw Error('Must not clear populated data');}}};
  const dropdown={value(value){dropdownValue=value;},trigger(){duration=JSON.parse(dropdownValue).Duration;}};
  const picker={};
  const context=vm.createContext({Date,Promise,Array,Number,Set,JSON,setTimeout,location:{hostname:'unimelb.perfectmind.com',pathname:'/32617/Clients/BookMe4LandingPages/Facility'},document:{getElementById:id=>id==='scheduler'?element:{}},window:{ko:{dataFor:()=>model},jQuery:selector=>({data:()=>selector===element?scheduler:selector==='#jump-to-date'?picker:dropdown})}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','collector.js'),'utf8'),context);
  const result=await context.collectCourtPage({date:'2026-10-26',court:'A'});
  return {result,duration};
}
(async()=>{
  const normalized=await collect();assert.equal(normalized.duration,30);assert.equal(normalized.result.slots.length,1);assert.equal(normalized.result.slots[0].start,840);
  assert.equal((await collect({initialDuration:30})).result.slots.length,1);
  assert.match((await collect({missingDuration:true})).result.error,/30-minute duration control/);
  console.log('Passed: normalize retained duration to 30min, preserve populated data and return actionable collector errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
