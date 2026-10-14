const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function check({limit, failCourt, cancel = false}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', checked: false, disabled: false, hidden: false,
      dataset: {}, textContent: '', innerHTML: '', addEventListener() {}
    });
    return elements.get(id);
  };
  const live = new Map(), created = [], removed = [], processed = [];
  let sequence = 0, peak = 0, saved, writers = 0, peakWriters = 0;
  const chrome = {
    runtime: {id: 'test-extension'},
    tabs: {
      async getCurrent() { return {id: 999, windowId: 42}; },
      async create(options) {
        assert.equal(options.active, false, 'loading tabs must stay inactive');
        assert.equal(options.windowId, 42, 'tabs must stay in the panel window');
        const id = ++sequence;
        live.set(id, options); created.push(id); peak = Math.max(peak, live.size);
        await pause(1);
        return {id};
      },
      async get(id) {
        if (!live.has(id)) throw new Error('Tab closed');
        return {id, status: 'complete'};
      },
      async update(id, options) { Object.assign(live.get(id), options); },
      async remove(id) {
        assert.notEqual(id, 999, 'never close the panel or a user tab');
        live.delete(id); removed.push(id);
      }
    },
    scripting: {
      async executeScript({target, args}) {
        const request = args[0];
        processed.push(request.court);
        await pause(10 + target.tabId % 3);
        if (!live.has(target.tabId)) throw new Error('Tab closed');
        if (request.court === failCourt) throw new Error('Simulated court failure');
        return [{result: {
          dates: ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'],
          slots: [{date: request.date, start: 840, end: 870, court: request.court}],
          observedAt: new Date().toISOString(), diagnostics: {slotCount: 1}
        }}];
      }
    },
    storage: {local: {
      async get() { return {}; },
      async set(value) {
        writers++; peakWriters = Math.max(peakWriters, writers);
        await pause(2);
        saved = value.snapshot; writers--;
      }
    }}
  };
  const context = vm.createContext({
    console, chrome, Date, Intl, URL, URLSearchParams, Blob, Set, Map,
    structuredClone, setTimeout, clearTimeout,
    document: {getElementById: element}, window: {addEventListener() {}}
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'collector.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  await pause(0); // Allow saved-state initialisation to finish.
  element('from').value = '2026-10-26'; element('to').value = '2026-10-30';
  element('time-from').value = '14:00'; element('time-to').value = '22:00';
  const run = vm.runInContext('start({preventDefault(){}})', context);
  assert.equal(element('checking-loader').hidden, false);
  assert.match(element('checking-message').textContent, /background tab/);
  assert.match(element('checking-message').textContent, /Please wait/);
  if (cancel) { await pause(3); vm.runInContext('requestStop()', context); }
  await run;
  assert.equal(live.size, 0, 'all owned loading tabs must be closed');
  assert.equal(new Set(removed).size, created.length, 'every created tab must be closed');
  assert.ok(peak <= limit, 'do not exceed the selected concurrency');
  assert.equal(peakWriters, 1, 'snapshot writes must be serialised');
  assert.equal(element('start').disabled, false);
  assert.equal(element('stop').disabled, true);
  assert.equal(element('checking-loader').hidden, true, 'hide the loading notice on success, failure and stop');
  if (cancel) {
    assert.ok(created.length <= limit, 'cancel must not launch queued courts');
    assert.equal(saved.errors.length, 0, 'cancellation is not a court failure');
    assert.match(element('status').textContent, /^Stopped/);
  } else {
    assert.equal(new Set(processed).size, 8, 'process every court exactly once');
    assert.equal(processed.length, 8);
    assert.equal(peak, limit);
    assert.equal(saved.slots.length, failCourt ? 7 : 8, 'retain all concurrent results');
    assert.equal(saved.errors.length, failCourt ? 1 : 0);
    assert.match(element('status').textContent, failCourt ? /7\/8/ : /8\/8/);
    for (const court of 'ABCDEFGH') {
      if (court !== failCourt) assert.equal(Object.keys(saved.coverage[court]).length, 5);
    }
  }
}

(async () => {
  await check({limit: 8});
  await check({limit: 8, failCourt: 'C'});
  await check({limit: 8, cancel: true});
  console.log('Passed: all-eight concurrency, inactive tabs, loading notice, window isolation, result merging, serialised storage, failure isolation, stop and cleanup.');
})().catch(error => {console.error(error); process.exitCode = 1;});
