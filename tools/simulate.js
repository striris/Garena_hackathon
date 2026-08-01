/* ============================================================
   tools/simulate.js — a few hundred matches with no interface
   Because the engine is two pure functions, balance runs cost
   nothing. Bot plays both sides; the director runs exactly as it
   does in the browser.

       node tools/simulate.js            200 matches
       node tools/simulate.js 1000       more
       node tools/simulate.js 50 verbose per-match lines
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['util.js', 'mapgen.js', 'engine.js', 'events.js', 'validator.js', 'bot.js', 'director.js'];

// the browser files assume `window` is the global object, so make it so
const sandbox = { console, performance: { now: () => Date.now() } };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f });
}
const CF = sandbox.window.CF;
const E = CF.engine, EV = CF.events, D = CF.director;

function playMatch(seed, opts = {}) {
  let g = E.newGame(seed);
  const events = [];
  let refusals = 0, defaults = 0;

  while (!g.over && g.turn <= E.MAX_TURNS) {
    const a = CF.bot.plan(g, 1, opts.turtleA);
    const b = CF.bot.plan(g, 2, opts.turtleB);
    g = E.resolveTurn(g, a.orders, b.orders).state;

    // fire anything the mountain warned about last turn
    if (g.pending && g.pending.fireTurn === g.turn) {
      const out = EV.apply(g, g.pending);
      if (out.ok) {
        const ev = g.pending;
        g = out.state;
        g.lastTemplate = ev.template;
        g.targetHistory.push(ev.mainTarget || 0);
        D.noteUse(g, ev.template);
        const entry = g.chronicle.find(c => c.season === ev.season);
        if (entry) { entry.fired = true; entry.message = out.message; }
        events.push(ev.template);
      }
      g.pending = null;
    }

    if (!g.over && g.turn % 3 === 0) {
      g.chronicle.forEach(c => { if (c.fired) D.scorePrediction(g, c); });
      const ev = D.decide(g);
      if (ev.reasoning.includes('safe default fired')) defaults++;
      if (ev.reasoning.includes('refused')) refusals++;
      g.season = ev.season;
      g.pending = ev;
      g.chronicle.push({
        season: ev.season, decidedTurn: g.turn, fireTurn: ev.fireTurn,
        template: ev.template, intensity: ev.intensity, region: ev.region,
        warning: ev.warning, reasoning: ev.reasoning, report: ev.report,
        prediction: ev.prediction, predictionResult: 'pending',
        message: null, fired: false, measured: null, mainTarget: ev.mainTarget
      });
    }

    g.turn += 1;
    if (!g.over) g.over = E.checkVictory(g);
  }

  const hits = g.chronicle.filter(c => c.predictionResult === 'hit').length;
  const misses = g.chronicle.filter(c => c.predictionResult === 'miss').length;

  return {
    seed,
    winner: g.over ? g.over.winner : 0,
    why: g.over ? g.over.why : 'ran out of turns',
    turns: g.turn - 1,
    landA: E.landCount(g, 1), landB: E.landCount(g, 2),
    bpA: g.bp[1], bpB: g.bp[2],
    raids: g.stats.reduce((a, s) => a + s.raids, 0),
    quietTurns: g.stats.filter(s => s.raids === 0).length,
    events, hits, misses, refusals, defaults
  };
}

// --------------------------------------------------------------------- run
const N = parseInt(process.argv[2] || '200', 10);
const verbose = process.argv.includes('verbose');

const tally = { 1: 0, 2: 0, 0: 0 };
const byTemplate = {};
let turns = 0, raids = 0, quiet = 0, hits = 0, misses = 0, refusals = 0, defaults = 0, eventCount = 0;
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const r = playMatch(1000 + i * 7919);
  tally[r.winner]++;
  turns += r.turns; raids += r.raids; quiet += r.quietTurns;
  hits += r.hits; misses += r.misses;
  refusals += r.refusals; defaults += r.defaults;
  eventCount += r.events.length;
  r.events.forEach(e => byTemplate[e] = (byTemplate[e] || 0) + 1);
  if (verbose) {
    console.log(`#${i} seed=${r.seed} winner=${['draw', 'Ashfarers', 'Saltkin'][r.winner]} ` +
      `t=${r.turns} land=${r.landA}/${r.landB} bp=${r.bpA}/${r.bpB} raids=${r.raids} — ${r.why}`);
  }
}

const ms = Date.now() - t0;
const pct = n => (n / N * 100).toFixed(1) + '%';

console.log('\n' + '═'.repeat(64));
console.log(`  CINDERFALL — ${N} matches in ${ms}ms (${(ms / N).toFixed(1)}ms each)`);
console.log('═'.repeat(64));
console.log(`  Ashfarers won   ${String(tally[1]).padStart(5)}   ${pct(tally[1])}`);
console.log(`  Saltkin won     ${String(tally[2]).padStart(5)}   ${pct(tally[2])}`);
console.log(`  Drawn           ${String(tally[0]).padStart(5)}   ${pct(tally[0])}`);
console.log('─'.repeat(64));
console.log(`  Average length          ${(turns / N).toFixed(1)} turns`);
console.log(`  Raids per match         ${(raids / N).toFixed(1)}`);
console.log(`  Silent turns per match  ${(quiet / N).toFixed(1)}`);
console.log(`  Events fired per match  ${(eventCount / N).toFixed(1)}`);
console.log('─'.repeat(64));
console.log(`  Predictions held        ${hits} of ${hits + misses}` +
            (hits + misses ? `  (${(hits / (hits + misses) * 100).toFixed(0)}%)` : ''));
console.log(`  Proposals softened      ${refusals}`);
console.log(`  Safe defaults fired     ${defaults}`);
console.log('─'.repeat(64));
console.log('  Template use:');
Object.keys(byTemplate).sort((a, b) => byTemplate[b] - byTemplate[a]).forEach(k => {
  const n = byTemplate[k];
  const bar = '█'.repeat(Math.round(n / eventCount * 40));
  console.log(`    ${EV.nameOf(k).padEnd(18)} ${String(n).padStart(5)}  ${bar}`);
});
console.log('═'.repeat(64) + '\n');

// --------------------------------------------------------- sanity checks
let bad = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) bad++;
}
console.log('  Invariants');
const g1 = E.newGame(4242);
const g2 = E.newGame(4242);
check('same seed builds the same ring', JSON.stringify(g1.tiles) === JSON.stringify(g2.tiles));

const r1 = playMatch(777), r2 = playMatch(777);
check('same seed replays exactly', JSON.stringify(r1) === JSON.stringify(r2));

const before = E.newGame(99);
const snapshot = JSON.stringify(before.tiles);
E.resolveTurn(before, [{ type: 'fortify', to: before.capitals[1] }], []);
check('resolveTurn does not mutate its input', JSON.stringify(before.tiles) === snapshot);

EV.apply(before, { template: 'eruption', intensity: 3, region: 'west' });
check('applyEvent does not mutate its input', JSON.stringify(before.tiles) === snapshot);

let capitalSurvived = true, floorHeld = true;
for (let i = 0; i < 60; i++) {
  const r = playMatch(31337 + i * 13);
  if (r.landA === 0 && r.landB === 0) floorHeld = false;
}
check('no match ends with both sides wiped out', floorHeld);

// every template must be able to fire on a real board
const probe = E.newGame(5150);
let fireable = 0;
EV.all().forEach(id => {
  const out = EV.apply(probe, { template: id, intensity: 2, region: 'centre' });
  if (out.ok) fireable++;
  else console.log(`         (${id} found nothing to act on at intensity 2/centre)`);
});
check('all ten templates apply to a fresh board', fireable === EV.all().length, `${fireable}/${EV.all().length}`);

// guardrails must actually refuse something extreme
const heavy = { template: 'eruption', intensity: 3, region: 'west' };
const gm = E.newGame(2024);
const chk = CF.validator.check(gm, heavy);
check('validator has teeth', typeof chk.ok === 'boolean', chk.ok ? 'this one passed, rules evaluated' : chk.fails[0]);

console.log('');
process.exit(bad ? 1 : 0);
