/* ============================================================
   tools/simulate.js — CINDERFALL Lite headless balance harness

       node tools/simulate.js             400 matches
       node tools/simulate.js 1000        larger balance sample
       node tools/simulate.js 50 verbose  per-match lines
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['util.js', 'mapgen.js', 'engine.js', 'events.js', 'validator.js', 'bot.js', 'profile.js', 'director.js'];
const sandbox = { console, performance: { now: () => Date.now() } };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), sandbox, { filename: file });
}

const CF = sandbox.window.CF;
const E = CF.engine, EV = CF.events, D = CF.director, M = CF.mapgen;

function fireDueEvent(g, events) {
  if (!EV.isDue(g.pending, g.turn)) return { state: g, refused: 0 };
  const pending = g.pending;
  const guard = CF.validator.check(g, pending);
  if (!guard.ok) {
    g.pending = null;
    return { state: g, refused: 1 };
  }
  const out = EV.apply(g, pending);
  if (!out.ok) {
    g.pending = null;
    return { state: g, refused: 1 };
  }
  g = out.state;
  g.lastTemplate = pending.template;
  g.targetHistory.push(guard.mainTarget || 0);
  if (D.noteUse) D.noteUse(g, pending.template);
  const entry = g.chronicle.find(c => c.season === pending.season);
  if (entry) { entry.fired = true; entry.message = out.message; }
  events.push(pending.template);
  g.pending = null;
  return { state: g, refused: 0 };
}

function scheduleEvent(g) {
  try {
    const ev = D.decide(g);
    if (!ev) return { state: g, fallback: 1 };
    g.season = ev.season;
    g.pending = ev;
    g.chronicle.push({
      season: ev.season,
      decidedTurn: g.turn,
      fireTurn: ev.fireTurn,
      template: ev.template,
      intensity: ev.intensity,
      region: ev.region,
      affected: ev.affected,
      warning: ev.warning,
      reasoning: ev.reasoning,
      report: ev.report,
      prediction: ev.prediction,
      predictionResult: 'pending',
      message: null,
      fired: false,
      measured: null,
      mainTarget: ev.mainTarget
    });
    return { state: g, fallback: /fallback/i.test(ev.reasoning || '') ? 1 : 0 };
  } catch (err) {
    // The deterministic match must remain playable even if the Director has
    // no valid candidate or an external AI response is unusable.
    return { state: g, fallback: 1 };
  }
}

function playMatch(seed, opts = {}) {
  let g = E.newGame(seed);
  const events = [];
  let refusals = 0, fallbacks = 0;
  const cards = { 1: null, 2: null };

  while (!g.over) {
    if ((g.turn - 1) % 3 === 0) {
      cards[1] = CF.bot.chooseStrategyCard(g, 1, !!opts.turtleA);
      cards[2] = CF.bot.chooseStrategyCard(g, 2, !!opts.turtleB);
    }
    const a = CF.bot.plan(g, 1, !!opts.turtleA, cards[1]);
    const b = CF.bot.plan(g, 2, !!opts.turtleB, cards[2]);
    if (opts.trace) console.log(`  T${g.turn} cards=${cards[1].id}/${cards[2].id} ` +
      `A=${JSON.stringify(a.orders)} B=${JSON.stringify(b.orders)} bp=${g.bp[1]}/${g.bp[2]}`);
    g = E.resolveTurn(g, a.orders, b.orders).state;

    if (!noEvents && !g.over && EV.isDue(g.pending, g.turn)) {
      const fired = fireDueEvent(g, events);
      g = fired.state;
      refusals += fired.refused;
    }

    if (!noEvents && !g.over && g.stats.length < E.MAX_TURNS && g.turn % 3 === 0) {
      g.chronicle.forEach(c => { if (c.fired && D.scorePrediction) D.scorePrediction(g, c); });
      const scheduled = scheduleEvent(g);
      g = scheduled.state;
      fallbacks += scheduled.fallback;
    }

    if (opts.trace) {
      const bt = g.tiles[g.beacon];
      console.log(`      -> Beacon ${g.beacon} owner=${bt && bt.owner || 0} supplied=${bt && g.supply[g.beacon] === bt.owner ? 1 : 0} ` +
        `pending=${g.pending ? g.pending.template + '@' + g.pending.fireTurn : '-'}`);
    }

    if (!g.over) g.over = E.checkVictory(g);
    if (!g.over) g.turn++;
  }

  const hits = g.chronicle.filter(c => c.predictionResult === 'hit').length;
  const misses = g.chronicle.filter(c => c.predictionResult === 'miss').length;
  return {
    seed,
    winner: g.over ? g.over.winner : 0,
    why: g.over ? g.over.why : 'no result',
    turns: g.stats.length,
    landA: E.landCount(g, 1),
    landB: E.landCount(g, 2),
    bpA: g.bp[1],
    bpB: g.bp[2],
    raids: g.stats.reduce((n, s) => n + (s.raids || 0), 0),
    synergy: g.stats.reduce((n, s) => n + (s.synergyAttacks || 0), 0),
    boosted: g.stats.reduce((n, s) => n + (s.tokensSpent[1] || 0) + (s.tokensSpent[2] || 0), 0),
    maxCutOff: g.stats.reduce((n, s) => Math.max(n, s.cutOffA || 0, s.cutOffB || 0), 0),
    silentTurns: g.stats.filter(s => !s.territoryChanged).length,
    events,
    hits,
    misses,
    refusals,
    fallbacks
  };
}

// --------------------------------------------------------------------- run
const N = Math.max(1, parseInt(process.argv[2] || '400', 10));
const verbose = process.argv.includes('verbose');
const noEvents = process.argv.includes('noevents');
const tally = { 0: 0, 1: 0, 2: 0 };
const byTemplate = {};
let turns = 0, raids = 0, synergy = 0, boosted = 0, cutOffMatches = 0;
let silent = 0, totalResolvedTurns = 0, eventsFired = 0;
let hits = 0, misses = 0, refusals = 0, fallbacks = 0;
const started = Date.now();

for (let i = 0; i < N; i++) {
  const result = playMatch(1000 + i * 7919, { trace: verbose && N === 1 });
  tally[result.winner]++;
  turns += result.turns;
  totalResolvedTurns += result.turns;
  raids += result.raids;
  synergy += result.synergy;
  boosted += result.boosted;
  silent += result.silentTurns;
  if (result.maxCutOff > 0) cutOffMatches++;
  hits += result.hits;
  misses += result.misses;
  refusals += result.refusals;
  fallbacks += result.fallbacks;
  eventsFired += result.events.length;
  result.events.forEach(id => { byTemplate[id] = (byTemplate[id] || 0) + 1; });
  if (verbose) {
    console.log(`#${i} seed=${result.seed} winner=${['draw', 'Ashfarers', 'Saltkin'][result.winner]} ` +
      `t=${result.turns} land=${result.landA}/${result.landB} bp=${result.bpA}/${result.bpB} ` +
      `raids=${result.raids} cutoff=${result.maxCutOff} — ${result.why}`);
  }
}

const elapsed = Date.now() - started;
const pct = n => (n / N * 100).toFixed(1) + '%';
const averageTurns = turns / N;
const drawRate = tally[0] / N;
const silentRate = totalResolvedTurns ? silent / totalResolvedTurns : 0;
const cutoffRate = cutOffMatches / N;
const balanceGap = Math.abs(tally[1] - tally[2]) / N;

console.log('\n' + '═'.repeat(66));
console.log(`  CINDERFALL LITE — ${N} matches in ${elapsed}ms (${(elapsed / N).toFixed(1)}ms each)`);
console.log('═'.repeat(66));
console.log(`  Ashfarers won       ${String(tally[1]).padStart(5)}   ${pct(tally[1])}`);
console.log(`  Saltkin won         ${String(tally[2]).padStart(5)}   ${pct(tally[2])}`);
console.log(`  Drawn               ${String(tally[0]).padStart(5)}   ${pct(tally[0])}`);
console.log('─'.repeat(66));
console.log(`  Average length              ${averageTurns.toFixed(1)} turns`);
console.log(`  Silent resolved turns       ${(silentRate * 100).toFixed(1)}%`);
console.log(`  Matches with cut-offs       ${cutOffMatches}  (${pct(cutOffMatches)})`);
console.log(`  Raids / coordinated         ${(raids / N).toFixed(1)} / ${(synergy / N).toFixed(1)} per match`);
console.log(`  Boosted commands            ${(boosted / N).toFixed(1)} per match`);
console.log(`  Events fired                ${(eventsFired / N).toFixed(1)} per match`);
console.log(`  Director fallbacks/refusals ${fallbacks}/${refusals}`);
console.log(`  Predictions held            ${hits}/${hits + misses}`);
console.log('─'.repeat(66));
console.log('  Event use:');
Object.keys(byTemplate).sort((a, b) => byTemplate[b] - byTemplate[a]).forEach(id => {
  const count = byTemplate[id];
  const denom = eventsFired || 1;
  console.log(`    ${EV.nameOf(id).padEnd(20)} ${String(count).padStart(5)}  ${'█'.repeat(Math.round(count / denom * 32))}`);
});

function target(name, ok, value) {
  console.log(`  ${ok ? 'PASS' : 'MISS'}  ${name.padEnd(30)} ${value}`);
}
console.log('─'.repeat(66));
console.log('  400-match balance targets');
target('average 11–14 turns', averageTurns >= 11 && averageTurns <= 14, averageTurns.toFixed(2));
target('draws under 10%', drawRate < 0.10, (drawRate * 100).toFixed(1) + '%');
target('silent turns under 35%', silentRate < 0.35, (silentRate * 100).toFixed(1) + '%');
target('cut-offs in at least 60%', cutoffRate >= 0.60, (cutoffRate * 100).toFixed(1) + '%');
target('win-rate gap at most 10pp', balanceGap <= 0.10, (balanceGap * 100).toFixed(1) + 'pp');
console.log('═'.repeat(66) + '\n');

// --------------------------------------------------------- deterministic checks
let bad = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) bad++;
}

console.log('  Lite invariants');
const g1 = E.newGame(4242);
const g2 = E.newGame(4242);
check('same seed builds the same game', JSON.stringify(g1.tiles) === JSON.stringify(g2.tiles));
check('capitals and every tile are 180° symmetric',
  g1.capitals[2] === M.twin(g1.capitals[1]) && g1.tiles.every((t, i) => {
    const twin = g1.tiles[M.twin(i)];
    return t.land === twin.land && t.elev === twin.elev && !!t.fertileSite === !!twin.fertileSite;
  }));
check('the two complete route bands and permanent mirrored bridges remain',
  [2, 3, 6, 7].every(y => { for (let x = 1; x <= 12; x++) if (!g1.tiles[M.idx(x, y)].land) return false; return true; }) &&
  [M.idx(3, 4), M.idx(4, 5), M.idx(9, 4), M.idx(10, 5)].every(i => g1.tiles[i].land && g1.tiles[i].bridge));
check('all four Relays are two tiles wide and attackable',
  Object.keys(g1.relays).length === 4 && Object.values(g1.relays).every(zone => zone.length === 2 &&
    zone.every(i => g1.tiles[i].relay && g1.tiles[i].elev === 0)));

const fertile = g1.tiles.map((t, i) => t.fertileSite ? i : -1).filter(i => i >= 0);
const ownedFertile = fertile.filter(i => g1.tiles[i].owner === 1 || g1.tiles[i].owner === 2);
const neutralFertile = fertile.filter(i => g1.tiles[i].owner === 0);
check('four visible fertile sites form home and contested symmetric pairs',
  fertile.length === 4 && ownedFertile.length === 2 && neutralFertile.length === 2 &&
  ownedFertile.every(i => fertile.includes(M.twin(i))) && neutralFertile.every(i => neutralFertile.includes(M.twin(i))));
check('terrain and starting strength use Lite ranges',
  g1.tiles.every(t => (t.elev === 0 || t.elev === 1) && t.str <= E.MAX_STRENGTH));
check('both sides begin with one token from a supplied home site',
  g1.tokens[1] === 1 && g1.tokens[2] === 1 && E.tokenIncome(g1, 1) === 1 && E.tokenIncome(g1, 2) === 1);

const pure = E.newGame(1001);
const pureJSON = JSON.stringify(pure);
E.resolveTurn(pure, [], []);
check('resolveTurn never mutates its input', JSON.stringify(pure) === pureJSON);

let march = E.newGame(2002);
const m1 = M.idx(2, 3), m2 = M.idx(3, 3), m3 = M.idx(4, 3);
march = E.resolveTurn(march, [
  { type: 'expand', to: m1 },
  { type: 'expand', from: m1, to: m2 },
  { type: 'expand', from: m2, to: m3 }
], []).state;
check('exactly two free commands resolve and a third is ignored',
  march.tiles[m1].owner === 1 && march.tiles[m2].owner === 1 && march.tiles[m3].owner === 0 &&
  march.stats[0].fieldCommands[1] === 2 && march.stats[0].tokensSpent[1] === 0);

let boostedExpand = E.newGame(2003);
boostedExpand = E.resolveTurn(boostedExpand, [{ type: 'expand', to: m1, boosted: true }], []).state;
check('a boosted Expand spends one token and starts at strength two',
  boostedExpand.tiles[m1].str === E.BOOSTED_EXPAND_STRENGTH && boostedExpand.stats[0].tokensSpent[1] === 1);

let tokenCap = E.newGame(2004);
tokenCap = E.resolveTurn(tokenCap, [], []).state;
tokenCap.turn++;
tokenCap = E.resolveTurn(tokenCap, [], []).state;
check('unused tokens carry over but never exceed two', tokenCap.tokens[1] === E.TOKEN_CAP && tokenCap.tokens[2] === E.TOKEN_CAP);

let fort = E.newGame(2005);
const fortAt = fort.capitals[1];
fort.tiles[fortAt].str = 1;
fort = E.resolveTurn(fort, [{ type: 'fortify', to: fortAt, boosted: true }], []).state;
check('boosted Fortify gives two but respects strength four', fort.tiles[fortAt].str === 3);

function combatBoard() {
  const g = E.newGame(3003);
  for (let x = 1; x <= 4; x++) {
    const i = M.idx(x, 2);
    g.tiles[i].owner = 1;
    g.tiles[i].str = 2;
  }
  for (let x = 1; x <= 3; x++) {
    const i = M.idx(x, 3);
    g.tiles[i].owner = 1;
    g.tiles[i].str = 2;
  }
  const target = M.idx(4, 3);
  // Keep the defender supplied so this probe isolates combat damage from the
  // separate, intentional end-of-turn cut-off decay.
  for (let x = 5; x <= 12; x++) {
    const i = M.idx(x, 3);
    g.tiles[i].owner = 2;
    g.tiles[i].str = 2;
  }
  g.tiles[M.idx(12, 4)].owner = 2;
  g.tiles[M.idx(12, 4)].str = 2;
  g.tiles[target].owner = 2;
  g.tiles[target].str = 4;
  g.tiles[target].elev = 1;
  g.supply = E.computeSupply(g);
  return { g, target, sources: [M.idx(3, 3), M.idx(4, 2)] };
}

const soloSetup = combatBoard();
const soloSourceStr = soloSetup.g.tiles[soloSetup.sources[0]].str;
const soloTargetStr = soloSetup.g.tiles[soloSetup.target].str;
const solo = E.resolveTurn(soloSetup.g, [{ type: 'raid', from: soloSetup.sources[0], to: soloSetup.target }], []).state;
const boostedSetup = combatBoard();
const boostedRaid = E.resolveTurn(boostedSetup.g,
  [{ type: 'raid', from: boostedSetup.sources[0], to: boostedSetup.target, boosted: true }], []).state;
const pairSetup = combatBoard();
const pair = E.resolveTurn(pairSetup.g, [
  { type: 'raid', from: pairSetup.sources[0], to: pairSetup.target },
  { type: 'raid', from: pairSetup.sources[1], to: pairSetup.target }
], []).state;
check('strict equality fails with no attacker or defender damage',
  solo.tiles[soloSetup.target].owner === 2 && solo.tiles[soloSetup.target].str === soloTargetStr &&
  solo.tiles[soloSetup.sources[0]].str === soloSourceStr);
check('one boosted Raid adds one and can cross the strict threshold', boostedRaid.tiles[boostedSetup.target].owner === 1);
check('two distinct supplied Raid sources gain +2 coordination',
  pair.tiles[pairSetup.target].owner === 1 && pair.stats[0].synergyAttacks === 1);

let cut = E.newGame(4004);
const isolated = M.idx(7, 2), isolatedTarget = M.idx(7, 1);
cut.tiles[isolated].owner = 1;
cut.tiles[isolated].str = 2;
cut.supply = E.computeSupply(cut);
const cutOnce = E.resolveTurn(cut, [
  { type: 'fortify', to: isolated },
  { type: 'expand', from: isolated, to: isolatedTarget }
], []).state;
cutOnce.turn++;
const cutTwice = E.resolveTurn(cutOnce, [], []).state;
check('cut-off territory cannot source orders and loses one strength per turn',
  cutOnce.tiles[isolated].str === 1 && cutOnce.tiles[isolatedTarget].owner === 0 && cutTwice.tiles[isolated].owner === 0);

let beacon = E.newGame(5005);
beacon.tiles[beacon.beacon].owner = 1;
beacon.tiles[beacon.beacon].str = 2;
beacon.supply = E.computeSupply(beacon);
beacon = E.resolveTurn(beacon, [], []).state;
check('an unsupplied Beacon never scores', beacon.bp[1] === 0);

let deadline = E.newGame(6006);
for (let turn = 1; turn <= E.MAX_TURNS; turn++) {
  deadline.turn = turn;
  deadline = E.resolveTurn(deadline, [], []).state;
}
check('all fifteen turns are actionable', deadline.stats.length === 15 && deadline.stats[14].turn === 15 && !!E.checkVictory(deadline));

const northCard = { id: 'N', front: 'NORTH', posture: 'PRESS', priority: 'RELAY' };
const southCard = { id: 'S', front: 'SOUTH', posture: 'GROW', priority: 'BEACON' };
const northPlan = CF.bot.plan(g1, 2, false, northCard);
const southPlan = CF.bot.plan(g1, 2, false, southCard);
check('strategy cards materially change deterministic orders',
  JSON.stringify(northPlan.orders) !== JSON.stringify(southPlan.orders) &&
  northPlan.card.front === 'NORTH' && northPlan.card.posture === 'PRESS' &&
  southPlan.card.front === 'SOUTH' && southPlan.card.posture === 'GROW');
check('bot output is legal, token-limited, and at most two commands', [northPlan, southPlan].every(plan =>
  plan.orders.length <= E.COMMANDS_PER_TURN && E.commandPreview(g1, 2, plan.orders).ok && plan.spent <= E.tokensAvailable(g1, 2)));

check('world system exposes only five previewable Lite event classes',
  EV.all().length === 5 && ['ground_breaks', 'land_rises', 'bloom', 'beacon_moves', 'forts_crack'].every(id => EV.all().includes(id)),
  EV.all().join(', '));

console.log('');
process.exit(bad ? 1 : 0);
