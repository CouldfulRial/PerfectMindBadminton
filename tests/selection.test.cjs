const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function setup({failCourt}={}){
  const elements=new Map(),created=[],updates=[],removed=[],requests=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',checked:false,hidden:false,disabled:false,dataset:{},innerHTML:'',textContent:'',addEventListener(){}});
    return elements.get(id);
  };
  const date='2026-10-26',date2='2026-10-27';
  const slots=[['E',900],['A',930],['B',930],['B',960],['C',990]].map(([court,start])=>({court,date,start,end:start+30}));
  slots.push({court:'A',date:date2,start:930,end:960});
  const data={version:2,query:{from:date,to:date2,timeFrom:'15:00',timeTo:'17:00'},updatedAt:new Date().toISOString(),slots,coverage:Object.fromEntries('ABCDEFGH'.split('').map(c=>[c,{[date]:'ok',[date2]:'ok'}]))};
  let sequence=0;
  const chrome={
    runtime:{id:'test'},
    tabs:{
      async getCurrent(){return {id:999,windowId:42};},
      async create(options){assert.equal(options.active,false);assert.equal(options.windowId,42);const id=++sequence;created.push({id,options});return {id};},
      async get(id){return {id,status:'complete'};},
      async update(id,options){updates.push({id,options});},
      async remove(id){removed.push(id);}
    },
    scripting:{async executeScript({args}){
      const req=args[0];requests.push(req);await pause(2);
      const court=vm.runInContext('COURTS',context).find(c=>c.id===req.facilityId);
      if(court.letter===failCourt)return [{result:{error:'Session unavailable'}}];
      return [{result:{url:'https://unimelb.perfectmind.com/32617/Clients/BookMe4EventParticipants/FacilityBooking?court='+court.letter+'&start='+req.start+'&duration='+req.duration}}];
    }},
    storage:{local:{async get(){return {snapshot:data};},async set(){}}}
  };
  const context=vm.createContext({console,Date,Intl,URL,URLSearchParams,Blob,Set,Map,structuredClone,setTimeout,chrome,document:{getElementById:element},window:{addEventListener(){}}});
  for(const file of ['collector.js','booking.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  await pause(0);
  return {context,element,created,updates,removed,requests,run:code=>vm.runInContext(code,context)};
}

(async()=>{
  const test=await setup();
  assert.equal(test.run("addSession('E','2026-10-26',900)"),false);
  test.run('render()');
  assert.equal(test.created.length,0,'no booking pages before the required total');
  assert.equal(test.run("slotChoiceState('E','2026-10-26',900).initial"),true);
  assert.equal(test.run("slotChoiceState('B','2026-10-26',930).enabled"),true);
  assert.equal(test.run("slotChoiceState('A','2026-10-27',930).enabled"),false);
  assert.equal(test.run("slotChoiceState('B','2026-10-26',960).enabled"),false);
  assert.throws(()=>test.run("addSession('A','2026-10-27',930)"),/next consecutive/);
  assert.throws(()=>test.run("addSession('B','2026-10-26',960)"),/next consecutive/);
  assert.equal(test.run("addSession('A','2026-10-26',930)"),true);
  const opening=test.run('openSelectedBookings()');test.run('resetSelection()');
  assert.equal(test.run('selection.slots.length'),2,'cannot reset an in-flight booking preparation');
  await opening;
  assert.equal(test.created.length,2);
  assert.equal(test.requests.length,2);
  assert.ok(test.requests.every(req=>req.duration===30),'a 1hr plan split across courts must use 30min for each');
  assert.deepEqual(test.requests.map(req=>req.start),[900,930]);
  assert.equal(test.updates.filter(u=>u.options.url).length,2);
  assert.equal(test.removed.length,0,'keep official order pages open');
  assert.equal(test.run('selection.opened'),true);
  assert.throws(()=>test.run("addSession('B','2026-10-26',960)"),/reset/);

  const same=test.run("buildBookingPlan([{court:'A',date:'2026-10-26',start:900},{court:'A',date:'2026-10-26',start:930}])");
  assert.equal(same.length,1);assert.equal(same[0].duration,60);
  const separate=test.run("buildBookingPlan([{court:'A',date:'2026-10-26',start:900},{court:'B',date:'2026-10-26',start:930},{court:'A',date:'2026-10-26',start:960}])");
  assert.equal(separate.length,3,'do not merge non-adjacent sessions on the same court');

  const longer=await setup();longer.element('duration').value='120';
  for(const [court,start] of [['E',900],['B',930],['B',960]])assert.equal(longer.run(`addSession('${court}','2026-10-26',${start})`),false);
  assert.equal(longer.run("addSession('C','2026-10-26',990)"),true);
  await longer.run('openSelectedBookings()');
  assert.deepEqual(longer.requests.map(req=>req.duration),[30,60,30]);

  const failed=await setup({failCourt:'A'});
  failed.run("addSession('E','2026-10-26',900);addSession('A','2026-10-26',930)");
  await failed.run('openSelectedBookings()');
  assert.equal(failed.updates.filter(u=>u.options.url).length,0,'revalidate the full plan before navigating any order page');
  assert.equal(failed.removed.length,2,'close all failed preparation tabs');
  assert.equal(failed.element('retry-booking').hidden,false);
  failed.run('undoSelection()');assert.equal(failed.run('selection.slots.length'),1);
  failed.run('resetSelection()');assert.equal(failed.run('selection'),null);
  console.log('Passed: multi-court 30min selection, next-slot/date locking, duration totals, grouping, no early order pages, revalidation failure cleanup, undo/reset and duplicate prevention.');
})().catch(error=>{console.error(error);process.exitCode=1;});
