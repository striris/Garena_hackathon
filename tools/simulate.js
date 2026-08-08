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
const FILES = ['util.js', 'mapgen.js', 'engine.js', 'events.js', 'validator.js', 'bot.js', 'profile.js', 'director.js'];

// the browser files assume `window` is the global object, so make it so
const sandbox = { console, performance: { now: () => Date.now() } };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f });
}
const CF = sandbox.window.CF;
const E = CF.engine, EV = CF.events, D = CF.director, M = CF.mapgen;

function playMatch(seed, opts = {}) {
  let g = E.newGame(seed);
  const events = [];
  let refusals = 0, defaults = 0;

  while (!g.over) {
    const a = CF.bot.plan(g, 1, opts.turtleA);
    const b = CF.bot.plan(g, 2, opts.turtleB);
    g = E.resolveTurn(g, a.orders, b.orders).state;

    // fire anything the mountain warned about last turn
    if (!g.over && EV.isDue(g.pending, g.turn)) {
      const guard = CF.validator.check(g, g.pending);
      if (!guard.ok) {
        const entry = g.chronicle.find(c => c.season === g.pending.season);
        if (entry) {
          entry.message = 'Refused at execution: ' + guard.fails.join('; ');
          entry.predictionResult = 'refused';
        }
        g.pending = null;
      } else {
        const out = EV.apply(g, g.pending);
        if (out.ok) {
          const ev = g.pending;
          ev.mainTarget = guard.mainTarget || 0;
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
    }

    if (!g.over && g.stats.length < E.MAX_TURNS && g.turn % 3 === 0) {
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

    if (!g.over) g.over = E.checkVictory(g);
    if (!g.over) g.turn += 1;
  }

  const hits = g.chronicle.filter(c => c.predictionResult === 'hit').length;
  const misses = g.chronicle.filter(c => c.predictionResult === 'miss').length;

  return {
    seed,
    winner: g.over ? g.over.winner : 0,
    why: g.over ? g.over.why : 'ran out of turns',
    turns: g.stats.length,
    landA: E.landCount(g, 1), landB: E.landCount(g, 2),
    bpA: g.bp[1], bpB: g.bp[2],
    raids: g.stats.reduce((a, s) => a + s.raids, 0),
    synergy: g.stats.reduce((a, s) => a + (s.synergyAttacks || 0), 0),
    maxCutOff: g.stats.reduce((a, s) => Math.max(a, s.cutOffA || 0, s.cutOffB || 0), 0),
    pressureEroded: g.stats.some(s => s.pressure && s.pressure.staleTurns >= 3),
    quietTurns: g.stats.filter(s => s.raids === 0).length,
    events, hits, misses, refusals, defaults
  };
}

// --------------------------------------------------------------------- run
const N = parseInt(process.argv[2] || '200', 10);
const verbose = process.argv.includes('verbose');

const tally = { 1: 0, 2: 0, 0: 0 };
const byTemplate = {};
let turns = 0, raids = 0, synergy = 0, cutOffMatches = 0, pressureMatches = 0;
let quiet = 0, hits = 0, misses = 0, refusals = 0, defaults = 0, eventCount = 0;
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const r = playMatch(1000 + i * 7919);
  tally[r.winner]++;
  turns += r.turns; raids += r.raids; quiet += r.quietTurns;
  synergy += r.synergy;
  if (r.maxCutOff > 0) cutOffMatches++;
  if (r.pressureEroded) pressureMatches++;
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
console.log(`  Coordinated breaches    ${(synergy / N).toFixed(1)} per match`);
console.log(`  Matches with cut-offs   ${cutOffMatches}  (${pct(cutOffMatches)})`);
console.log(`  Pressure erosion seen   ${pressureMatches}  (${pct(pressureMatches)})`);
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

const northWhole = [2, 3].every(y => {
  for (let x = 1; x <= 12; x++) if (!g1.tiles[M.idx(x, y)].land) return false;
  return true;
});
const southWhole = [6, 7].every(y => {
  for (let x = 1; x <= 12; x++) if (!g1.tiles[M.idx(x, y)].land) return false;
  return true;
});
const centreReserved = [6, 7].every(x => [4, 5].every(y => {
  const t = g1.tiles[M.idx(x, y)];
  return !t.land && !!t.pressureReserved;
}));
const relayTiles = Object.values(g1.relays).flat();
const centralRouteBlocks = [[3, 4], [9, 10]].every(cols =>
  cols.every(x => g1.tiles[M.idx(x, 4)].land && g1.tiles[M.idx(x, 4)].route === 'north' &&
    g1.tiles[M.idx(x, 5)].land && g1.tiles[M.idx(x, 5)].route === 'south'));
check('map keeps the original ordinary blocks within the two routes',
  northWhole && southWhole && centralRouteBlocks && centreReserved && relayTiles.length === 8,
  `${relayTiles.length} Relay squares`);

let ladderSymmetric = true;
for (let i = 0; i < g1.tiles.length; i++) {
  const a = g1.tiles[i], b = g1.tiles[M.twin(i)];
  if (a.land !== b.land || a.elev !== b.elev || a.fert !== b.fert || !!a.relay !== !!b.relay) ladderSymmetric = false;
}
check('ladder land, terrain, capitals and Relays keep 180-degree symmetry', ladderSymmetric &&
  g1.capitals[2] === M.twin(g1.capitals[1]));

function landDistance(state, from, to) {
  const distance = new Int16Array(state.tiles.length).fill(-1);
  const queue = [from];
  distance[from] = 0;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const next of E.neighbors(state, at)) {
      if (distance[next] >= 0 || !state.tiles[next].land) continue;
      distance[next] = distance[at] + 1;
      queue.push(next);
    }
  }
  return distance[to];
}
check('opening Ash Surge and Beacon create one fair shared route objective',
  E.laneOf(g1, g1.beacon) === g1.opening.route &&
  landDistance(g1, g1.capitals[1], g1.beacon) === landDistance(g1, g1.capitals[2], g1.beacon),
  `${g1.opening.route} at equal distance ${landDistance(g1, g1.capitals[1], g1.beacon)}`);

const r1 = playMatch(777), r2 = playMatch(777);
check('same seed replays exactly', JSON.stringify(r1) === JSON.stringify(r2));

const before = E.newGame(99);
const snapshot = JSON.stringify(before.tiles);
E.resolveTurn(before, [{ type: 'fortify', to: before.capitals[1] }], []);
check('resolveTurn does not mutate its input', JSON.stringify(before.tiles) === snapshot);

// Fortify is command-limited, supplied-only, once per tile, +1, and capped.
let fortProbe = E.newGame(3301);
const fortTiles = E.ownedTiles(fortProbe, 1);
const fortA = fortTiles[0], fortB = fortTiles[1], fortC = M.idx(2, 3);
// Add one supplied north-route tile so this test isolates the three-action
// allowance rather than failing because the south route is deliberately
// locked after the first north-route order.
fortProbe.tiles[fortC].owner = 1;
fortProbe.tiles[fortA].str = 3;
fortProbe.tiles[fortB].str = 3;
fortProbe.tiles[fortC].str = 3;
fortProbe.supply = E.computeSupply(fortProbe);
const fortified = E.resolveTurn(fortProbe, [
  { type: 'fortify', to: fortA },
  { type: 'fortify', to: fortA },
  { type: 'fortify', to: fortB },
  { type: 'fortify', to: fortC }
], []).state;
const fortStat = fortified.stats[fortified.stats.length - 1];
check('Fortify is +1, once per square, and three actions can be spent',
  fortified.tiles[fortA].str === 4 && fortified.tiles[fortB].str === 4 && fortified.tiles[fortC].str === 4 &&
  fortStat.military[1] === 3 && fortStat.fieldCommands[1] === 3);

// The first order chooses this turn’s lane. Linked actions stay coherent, but
// the next turn begins with a fresh route choice and no redeployment tax.
let effortRules = E.newGame(3305);
effortRules.tiles[effortRules.capitals[1]].fert = 10;
effortRules.supply = E.computeSupply(effortRules);
const northOne = M.idx(2, 3), northTwo = M.idx(3, 3), southOne = M.idx(2, 5);
let effortTurn = E.resolveTurn(effortRules, [
  { type: 'expand', to: northOne },
  { type: 'expand', from: northOne, to: northTwo }
], []).state;
const firstEffortStat = effortTurn.stats[effortTurn.stats.length - 1];
check('two Claims can continue expansion two squares down one route',
  effortTurn.tiles[northOne].owner === 1 && effortTurn.tiles[northTwo].owner === 1 &&
  firstEffortStat.fieldCommands[1] === 2 && effortTurn.strategy[1].main === 'NORTH' &&
  effortTurn.strategy[1].untilTurn === 1);
effortTurn.turn = 2;
effortTurn.tiles[effortTurn.capitals[1]].fert = 10;
let lockedAttempt = E.resolveTurn(effortTurn, [{ type: 'expand', to: southOne }], []).state;
check('the next turn can choose the other route without a redeployment rule',
  lockedAttempt.tiles[southOne].owner === 1 &&
  lockedAttempt.stats[lockedAttempt.stats.length - 1].fieldCommands[1] === 1);

let southOpening = E.newGame(3306);
southOpening.tiles[southOpening.capitals[1]].fert = 10;
southOpening.tiles[southOpening.capitals[1]].str = 3;
southOpening.supply = E.computeSupply(southOpening);
const capitalHoldSouth = E.resolveTurn(southOpening, [
  { type: 'fortify', to: southOpening.capitals[1] },
  { type: 'expand', to: southOne }
], []).state;
check('Capital Hold is neutral and does not block a south-route opening',
  capitalHoldSouth.tiles[southOpening.capitals[1]].str === 4 &&
  capitalHoldSouth.tiles[southOne].owner === 1 && capitalHoldSouth.strategy[1].main === 'SOUTH' &&
  capitalHoldSouth.stats[capitalHoldSouth.stats.length - 1].fieldCommands[1] === 2);

effortTurn.turn = 4;
effortTurn.tiles[effortTurn.capitals[1]].fert = 10;
let redeployed = E.resolveTurn(effortTurn, [{ type: 'expand', to: southOne }], []).state;
const redeployStat = redeployed.stats[redeployed.stats.length - 1];
check('a later turn can change route using only its visible action',
  redeployed.tiles[southOne].owner === 1 && redeployStat.fieldCommands[1] === 1 &&
  redeployStat.redeploys[1] === 0 && redeployStat.mobilization[1] === 0 &&
  redeployStat.spent[1] === E.COST.expand &&
  redeployed.strategy[1].main === 'SOUTH' &&
  redeployed.strategy[1].untilTurn === 4);

function setSideIncome(state, side, amount) {
  E.ownedTiles(state, side).forEach(i => { state.tiles[i].fert = 0; });
  state.tiles[state.capitals[side]].fert = amount;
  state.opening.untilTurn = 0;
  state.supply = E.computeSupply(state);
}

let lowIncome = E.newGame(3310);
setSideIncome(lowIncome, 1, 5);
const lowFirst = M.idx(2, 3), lowSecond = M.idx(3, 3);
const lowResult = E.resolveTurn(lowIncome, [
  { type: 'expand', to: lowFirst },
  { type: 'expand', from: lowFirst, to: lowSecond }
], []).state;
const lowStat = lowResult.stats[lowResult.stats.length - 1];
check('income controls whether two Claims fit in the Supply budget',
  lowResult.tiles[lowFirst].owner === 1 && lowResult.tiles[lowSecond].owner === 0 &&
  lowStat.fieldCommands[1] === 1 && lowStat.spent[1] === E.COST.expand &&
  lowStat.reserveAfter[1] === 2);

let reserveProbe = E.newGame(3311);
setSideIncome(reserveProbe, 1, 20);
reserveProbe = E.resolveTurn(reserveProbe, [], []).state;
check('all unused income becomes reserve up to the cap',
  reserveProbe.reserve[1] === E.RESERVE_CAP);
setSideIncome(reserveProbe, 1, 0);
const reserveFirst = M.idx(2, 3), reserveSecond = M.idx(3, 3);
const reserveFunded = E.resolveTurn(reserveProbe, [
  { type: 'expand', to: reserveFirst },
  { type: 'expand', from: reserveFirst, to: reserveSecond }
], []).state;
const reserveStat = reserveFunded.stats[reserveFunded.stats.length - 1];
check('stored reserve funds two Claims but Supply blocks a third',
  reserveFunded.tiles[reserveFirst].owner === 1 && reserveFunded.tiles[reserveSecond].owner === 1 &&
  reserveStat.spent[1] === E.COST.expand * 2 &&
  reserveFunded.reserve[1] === E.RESERVE_CAP - E.COST.expand * 2 && reserveStat.fieldCommands[1] === 2);

let marchProbe = E.newGame(3312);
setSideIncome(marchProbe, 1, 8);
const marchFirst = M.idx(2, 3), marchSecond = M.idx(3, 3);
const marchOrders = [
  { type: 'expand', to: marchFirst },
  { type: 'expand', from: marchFirst, to: marchSecond }
];
marchOrders.support = true;
const marched = E.resolveTurn(marchProbe, marchOrders, []).state;
const marchStat = marched.stats[marched.stats.length - 1];
check('March Supply spends two and establishes the follow-through at strength two',
  marched.tiles[marchSecond].owner === 1 && marched.tiles[marchSecond].str === 2 &&
  marchStat.support[1] === 'march' && marchStat.spent[1] === 8);

let cutFort = E.newGame(3302);
const isolated = M.idx(7, 2);
cutFort.tiles[isolated].owner = 1;
cutFort.tiles[isolated].str = 5;
cutFort.supply = E.computeSupply(cutFort);
const cutBeforeStrength = cutFort.tiles[isolated].str;
const cutFortResult = E.resolveTurn(cutFort, [{ type: 'fortify', to: isolated }], []).state;
const cappedProbe = E.newGame(3303);
check('cut-off or strength-capped ground cannot Fortify',
  E.canFortify(cutFort, 1, isolated) == null &&
  E.canFortify(cappedProbe, 1, cappedProbe.capitals[1]) == null &&
  cutFortResult.tiles[isolated].str < cutBeforeStrength);

// A single equal-strength Raid fails; the same target attacked from two
// distinct supplied sources gains +2 and breaks through.
function synergyBoard() {
  const g = E.newGame(4404);
  for (let x = 1; x <= 3; x++) {
    const i = M.idx(x, 3);
    g.tiles[i].owner = 1; g.tiles[i].str = 2; g.tiles[i].fert = 3;
  }
  [M.idx(3, 2), M.idx(4, 2)].forEach(i => {
    g.tiles[i].owner = 1; g.tiles[i].str = 2; g.tiles[i].fert = 3;
  });
  const target = M.idx(4, 3);
  g.tiles[target].owner = 2; g.tiles[target].str = 4; g.tiles[target].elev = 1;
  g.supply = E.computeSupply(g);
  return { g, target, sources: [M.idx(3, 3), M.idx(4, 2)] };
}
const soloSetup = synergyBoard();
const solo = E.resolveTurn(soloSetup.g, [{ type: 'raid', from: soloSetup.sources[0], to: soloSetup.target }], []).state;
const pairSetup = synergyBoard();
const pairResult = E.resolveTurn(pairSetup.g, [
  { type: 'raid', from: pairSetup.sources[0], to: pairSetup.target },
  { type: 'raid', from: pairSetup.sources[1], to: pairSetup.target }
], []);
check('two supplied attack directions earn +2 and create a breakthrough',
  solo.tiles[soloSetup.target].owner === 2 && pairResult.state.tiles[pairSetup.target].owner === 1 &&
  pairResult.state.stats[pairResult.state.stats.length - 1].synergyAttacks === 1);

const siegePlain = synergyBoard();
siegePlain.g.tiles[siegePlain.target].str = 6;
setSideIncome(siegePlain.g, 1, 10);
const plainSiegeOrders = [
  { type: 'raid', from: siegePlain.sources[0], to: siegePlain.target },
  { type: 'raid', from: siegePlain.sources[1], to: siegePlain.target }
];
const plainSiege = E.resolveTurn(siegePlain.g, plainSiegeOrders, []).state;
const siegeFunded = synergyBoard();
siegeFunded.g.tiles[siegeFunded.target].str = 6;
setSideIncome(siegeFunded.g, 1, 10);
const fundedSiegeOrders = [
  { type: 'raid', from: siegeFunded.sources[0], to: siegeFunded.target },
  { type: 'raid', from: siegeFunded.sources[1], to: siegeFunded.target }
];
fundedSiegeOrders.support = true;
const fundedSiege = E.resolveTurn(siegeFunded.g, fundedSiegeOrders, []).state;
const siegeStat = fundedSiege.stats[fundedSiege.stats.length - 1];
check('Siege Support spends two and adds one only to a coordinated Raid',
  plainSiege.tiles[siegePlain.target].owner === 2 &&
  fundedSiege.tiles[siegeFunded.target].owner === 1 &&
  siegeStat.support[1] === 'siege' && siegeStat.spent[1] === E.COST.raid * 2 + E.SUPPORT_COST);

// Capturing both squares of a rear Relay blocks the opposing front from its
// capital, turning a local victory into a visible supply-line objective.
let relayProbe = E.newGame(4477);
for (let x = 5; x <= 12; x++) for (let y = 6; y <= 7; y++) {
  const i = M.idx(x, y); relayProbe.tiles[i].owner = 2; relayProbe.tiles[i].str = 2;
}
relayProbe.tiles[relayProbe.capitals[2]].owner = 2;
relayProbe.tiles[M.idx(12, 6)].owner = 2;
relayProbe.supply = E.computeSupply(relayProbe);
const relayOne = M.idx(9, 6), relayTwo = M.idx(9, 7);
relayProbe.tiles[relayOne].owner = 1; relayProbe.tiles[relayOne].str = 1;
relayProbe.supply = E.computeSupply(relayProbe);
const relayPreview = E.relayImpact(relayProbe, 1, relayTwo);
relayProbe.tiles[relayTwo].owner = 1; relayProbe.tiles[relayTwo].str = 1;
relayProbe.supply = E.computeSupply(relayProbe);
let relayCut = 0;
for (let x = 5; x <= 8; x++) for (let y = 6; y <= 7; y++) {
  if (relayProbe.supply[M.idx(x, y)] !== 2) relayCut++;
}
check('capturing both squares of a rear Relay cuts the opposite front',
  relayPreview && relayPreview.tiles === relayCut && relayCut >= 6,
  `${relayCut} Saltkin front squares cut off`);

let beaconProbe = E.newGame(5515);
beaconProbe.tiles[beaconProbe.beacon].owner = 1;
beaconProbe.tiles[beaconProbe.beacon].str = 4;
beaconProbe.supply = E.computeSupply(beaconProbe);
const beaconPoints = beaconProbe.bp[1];
const beaconResult = E.resolveTurn(beaconProbe, [], []).state;
check('an unsupplied Beacon scores no point', beaconProbe.supply[beaconProbe.beacon] !== 1 &&
  beaconResult.bp[1] === beaconPoints);

let pressureProbe = E.newGame(6606);
const frontA = M.idx(2, 3), frontB = M.idx(3, 3);
pressureProbe.tiles[frontA].owner = 1; pressureProbe.tiles[frontA].str = 5;
pressureProbe.tiles[frontB].owner = 2; pressureProbe.tiles[frontB].str = 6;
pressureProbe.supply = E.computeSupply(pressureProbe);
for (let turn = 1; turn <= 4; turn++) {
  pressureProbe.turn = turn;
  pressureProbe = E.resolveTurn(pressureProbe, [], []).state;
}
check('Cinder Pressure warns and erodes overbuilt contested walls',
  pressureProbe.pressure.staleTurns === 4 && pressureProbe.tiles[frontA].str < 5 &&
  pressureProbe.tiles[frontB].str < 6);

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
let fireable = 0, relayInfrastructureSurvives = true;
EV.all().forEach(id => {
  const out = EV.apply(probe, { template: id, intensity: 2, region: 'centre' });
  if (out.ok) {
    fireable++;
    Object.values(probe.relays).flat().forEach(i => {
      if (!out.state.tiles[i].land || !out.state.tiles[i].relay) relayInfrastructureSurvives = false;
    });
  }
  else console.log(`         (${id} found nothing to act on at intensity 2/centre)`);
});
check('all ten templates apply to a fresh board', fireable === EV.all().length, `${fireable}/${EV.all().length}`);
check('world events preserve visible Supply Relay infrastructure', relayInfrastructureSurvives);

// guardrails must actually refuse something extreme
const heavy = { template: 'eruption', intensity: 3, region: 'west' };
const gm = E.newGame(2024);
const chk = CF.validator.check(gm, heavy);
check('validator has teeth', typeof chk.ok === 'boolean', chk.ok ? 'this one passed, rules evaluated' : chk.fails[0]);

// A 25-turn match must accept and resolve the twenty-fifth set of orders.
// The old `turn >= 25` deadline ended the game immediately after turn 24.
let full = E.newGame(6060);
for (let turn = 1; turn <= E.MAX_TURNS; turn++) {
  full.turn = turn;
  full = E.resolveTurn(full, [], []).state;
}
check('turn 25 is actionable', full.stats.length === 25 && full.stats[24].turn === 25 &&
  !full.over && !!E.checkVictory(full), `${full.stats.length} turns resolved`);

// Human authority can choose a proposal, but cannot bypass hard safety rules.
const override = CF.validator.approveOverride(gm, heavy);
check('unsafe designer override is refused', !override.ok && override.ev === null,
  override.ok ? 'unsafe event was approved' : override.fails[0]);

// A pause can carry an event beyond its original fire turn without losing it.
check('overdue paused event remains due', !EV.isDue({ fireTurn: 4 }, 3) &&
  EV.isDue({ fireTurn: 4 }, 4) && EV.isDue({ fireTurn: 4 }, 7));

// Every square actually sunk by an earthquake must be inside the region named
// in its warning, for all five possible regions.
let quakeRegions = 0, quakeSinks = 0, quakeOutside = 0;
EV.REGIONS.forEach((region, n) => {
  const board = E.newGame(7000 + n * 101);
  const out = EV.apply(board, { template: 'earthquake', intensity: 3, region });
  if (!out.ok) return;
  const sunk = out.fx.filter(f => f.kind === 'sink');
  if (sunk.length) quakeRegions++;
  quakeSinks += sunk.length;
  quakeOutside += sunk.filter(f => !EV.inRegion(board, f.at, region)).length;
});
check('earthquake damage matches its warned region', quakeRegions === EV.REGIONS.length &&
  quakeSinks > 0 && quakeOutside === 0,
  `${quakeSinks} sunk squares across ${quakeRegions}/${EV.REGIONS.length} regions; ${quakeOutside} outside`);

// The Saltkin request is built only from resolved state; an extra current-order
// argument is deliberately ignored and never crosses the privacy boundary.
const secretOrder = 'UNSUBMITTED_ORDER_SENTINEL';
const privacyPayload = CF.profile.requestPayload(probe, 'privacy-test', [{ currentOrder: secretOrder }]);
const privacyJSON = JSON.stringify(privacyPayload);
check('Saltkin request excludes the current order queue', !privacyJSON.includes(secretOrder) &&
  !Object.prototype.hasOwnProperty.call(privacyPayload, 'orders') &&
  !Object.prototype.hasOwnProperty.call(privacyPayload, 'currentOrders'));

const commandCurve = [1, 2, 3, 4, 5, 6, 7, 8].map(turn => E.fieldCommands({ turn }));
check('action slots follow the capped 3/4/4/5/5/6 curve',
  commandCurve.join('/') === '3/4/4/5/5/6/6/6', commandCurve.join('/'));

const lifecycleBase = { pending: false, lastRequestTurn: 1, turn: 4, hasDoctrine: true,
  uses: 1, lostLand: 3, beaconChanged: true, worldChanged: true };
const lifecycleOk = !CF.profile.shouldRequestDoctrine(lifecycleBase) &&
  CF.profile.shouldRequestDoctrine(Object.assign({}, lifecycleBase, { uses: 2 })) &&
  CF.profile.shouldRequestDoctrine(Object.assign({}, lifecycleBase, { uses: 3, lostLand: 0, beaconChanged: false, worldChanged: false })) &&
  !CF.profile.shouldRequestDoctrine(Object.assign({}, lifecycleBase, { uses: 3, lastRequestTurn: 4 })) &&
  !CF.profile.shouldRequestDoctrine(Object.assign({}, lifecycleBase, { uses: 3, pending: true }));
check('Doctrine lasts two turns and requests at most once per turn', lifecycleOk);

let effortProbe = E.newGame(8181), effortMains = [], effortLegal = true;
for (let turn = 1; turn <= 2; turn++) {
  effortProbe.turn = turn;
  const plan = CF.bot.plan(effortProbe, 2, false);
  effortMains.push(plan.effort.main);
  const command = E.commandPreview(effortProbe, 2, plan.orders);
  const forts = plan.orders.filter(o => o.type === 'fortify').map(o => o.to);
  if (!command.ok || command.commands > E.fieldCommands(effortProbe) || new Set(forts).size !== forts.length) effortLegal = false;
  effortProbe = E.resolveTurn(effortProbe, [], plan.orders).state;
}
effortProbe.turn = 3;
const nextEffort = CF.bot.plan(effortProbe, 2, false).effort;
check('Saltkin choices remain command-limited while each turn chooses one route',
  effortLegal && nextEffort.issuedTurn === 3 && nextEffort.untilTurn === 3,
  `${effortMains.join('/')} then ${nextEffort.main}`);

let laneDiscipline = true, chainedAdvanceSeen = false;
for (let seed = 0; seed < 20; seed++) {
  let laneProbe = E.newGame(8500 + seed * 617);
  for (let turn = 1; turn <= 6; turn++) {
    laneProbe.turn = turn;
    const plans = [CF.bot.plan(laneProbe, 1, false), CF.bot.plan(laneProbe, 2, false)];
    plans.forEach((plan, sideIndex) => {
      const side = sideIndex + 1;
      const lanes = new Set(plan.orders.map(order => E.orderLane(laneProbe, order)));
      const preview = E.commandPreview(laneProbe, side, plan.orders);
      const cost = E.planCost(laneProbe, side, plan.orders, !!plan.orders.support);
      if (lanes.size > 1 || (lanes.size === 1 && !lanes.has(plan.effort.main)) ||
          !preview.ok || preview.commands > E.fieldCommands(laneProbe) || cost.total > E.availableBudget(laneProbe, side))
        laneDiscipline = false;
      const planned = [];
      plan.orders.forEach(order => {
        if (order.type !== 'expand') return;
        const direct = E.canExpand(laneProbe, side, order.to);
        const source = E.canExpand(laneProbe, side, order.to, planned);
        if (direct == null && source != null) chainedAdvanceSeen = true;
        planned.push(order);
      });
    });
    laneProbe = E.resolveTurn(laneProbe, plans[0].orders, plans[1].orders).state;
  }
}
check('bots never issue active orders on both routes in the same turn',
  laneDiscipline && chainedAdvanceSeen,
  chainedAdvanceSeen ? 'single-route discipline with chained expansion observed' : 'no chained expansion observed');

// Exhaust the Doctrine enum space. It may change scoring, never legality or
// budget enforcement, and the bot still refuses attacks that cannot land.
let doctrineLegal = true, doctrineCases = 0;
const doctrineProbe = E.newGame(9191);
['ASSAULT', 'GROWTH', 'FORTRESS'].forEach(stance => {
  ['BEACON', 'LAND', 'SUPPLY', 'CAPITAL'].forEach(objective => {
    ['NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTRE'].forEach(target_region => {
      ['LOW', 'MEDIUM', 'HIGH'].forEach(risk => {
        const plan = CF.bot.plan(doctrineProbe, 2, false, { stance, objective, target_region, risk });
        doctrineCases++;
        if (plan.spent > plan.budget) doctrineLegal = false;
        const command = E.commandPreview(doctrineProbe, 2, plan.orders);
        if (!command.ok || command.commands > E.fieldCommands(doctrineProbe)) doctrineLegal = false;
        const fortTargets = plan.orders.filter(order => order.type === 'fortify').map(order => order.to);
        if (new Set(fortTargets).size !== fortTargets.length) doctrineLegal = false;
        const raidGroups = {};
        const plannedExpands = [];
        plan.orders.forEach(order => {
          const legal = order.type === 'expand' ? E.canExpand(doctrineProbe, 2, order.to, plannedExpands)
            : order.type === 'fortify' ? E.canFortify(doctrineProbe, 2, order.to)
            : E.raidSources(doctrineProbe, 2, order.to).includes(order.from) ? order.from : null;
          if (legal == null) doctrineLegal = false;
          if (order.type === 'expand') plannedExpands.push(order);
          if (order.type === 'raid') (raidGroups[order.to] || (raidGroups[order.to] = [])).push(order.from);
        });
        Object.keys(raidGroups).forEach(target => {
          const supported = plan.support === 'siege' ? E.SIEGE_SUPPORT_BONUS : 0;
          if (E.coordinatedAttackValue(doctrineProbe, raidGroups[target], 2) + supported <= E.defenceValue(doctrineProbe, +target))
            doctrineLegal = false;
        });
      });
    });
  });
});
check('all Doctrines preserve legal, affordable bot orders', doctrineLegal, `${doctrineCases} doctrines`);

// Candidate generation and every three-turn rollout operate on clones. All
// offered choices have already passed both guardrails and the 40% agency cap.
let cf = E.newGame(8080);
for (let t = 1; t <= 6; t++) {
  cf.turn = t;
  const a = CF.bot.plan(cf, 1, false);
  const b = CF.bot.plan(cf, 2, false);
  cf = E.resolveTurn(cf, a.orders, b.orders).state;
}
cf.over = null;
const cfSnapshot = JSON.stringify(cf);
const prepared = D.prepare(cf, { stance: 'ASSAULT', objective: 'BEACON', target_region: 'CENTRE', risk: 'MEDIUM' });
const candidateSafe = prepared.candidates.length > 0 && prepared.candidates.length <= 10 &&
  prepared.candidates.every(c => CF.validator.check(cf, c.event).ok &&
    c.choiceImpact.ashfarers.loss <= 0.4 && c.choiceImpact.saltkin.loss <= 0.4 &&
    c.outcomes.length === 3);
check('Director offers only simulated, safe, agency-preserving candidates', candidateSafe,
  `${prepared.candidates.length} candidates`);
check('candidate simulation does not mutate the live match', JSON.stringify(cf) === cfSnapshot);

// Across mirrored starts, neutral candidate generation should not systematically
// identify one people as the main target.
let targetA = 0, targetB = 0;
for (let seed = 0; seed < 40; seed++) {
  let mirrorProbe = E.newGame(12000 + seed * 379);
  for (let t = 1; t <= 6; t++) {
    mirrorProbe.turn = t;
    const a = CF.bot.plan(mirrorProbe, 1, false);
    const b = CF.bot.plan(mirrorProbe, 2, false);
    mirrorProbe = E.resolveTurn(mirrorProbe, a.orders, b.orders).state;
  }
  mirrorProbe.over = null;
  D.enumerateCandidates(mirrorProbe, null).forEach(c => {
    if (c.mainTarget === 1) targetA++;
    if (c.mainTarget === 2) targetB++;
  });
}
const targeted = targetA + targetB;
check('Director candidate pool has no systematic side bias', targeted === 0 ||
  Math.abs(targetA - targetB) <= targeted * 0.25 + 2, `targets ${targetA}/${targetB}`);

console.log('');
process.exit(bad ? 1 : 0);
