/* CINDERFALL v0.2 deterministic rules: Expand, Raid, Guard. */
CF.engine = (function () {
  var U = CF.util;
  var COMMANDS_PER_TURN = 2, MAX_TURNS = 10, BEACON_TO_WIN = 4;
  var SIDE = { 1: 'Ashfarers', 2: 'Saltkin' };

  function newGame(seed) {
    var m = CF.mapgen.generate(seed), s = {
      W: m.W, H: m.H, tiles: m.tiles, capitals: m.capitals,
      beacon: m.beacon, nextBeacon: null, relays: {}, turn: 1,
      bp: { 1: 0, 2: 0 }, seed: m.seed, rngSeed: m.rngSeed,
      feed: [], chronicle: [], stats: [], targetHistory: [], memory: {}, pending: null,
      season: 0, lastTemplate: null, over: null
    };
    s.tiles.forEach(function (t) {
      t.str = t.owner ? 1 : 0;
      t.fertileSite = 0; t.fert = 0; t.relay = null;
    });
    s.supply = computeSupply(s);
    return s;
  }

  function neighbors(state, i) {
    if (i == null || i < 0 || i >= state.tiles.length) return [];
    var x = i % state.W, y = (i / state.W) | 0, out = [];
    if (x) out.push(i - 1); if (x < state.W - 1) out.push(i + 1);
    if (y) out.push(i - state.W); if (y < state.H - 1) out.push(i + state.W);
    return out;
  }
  function ownedTiles(s, side) { return s.tiles.map(function (t, i) { return t.land && t.owner === side ? i : -1; }).filter(function (i) { return i >= 0; }); }
  function landCount(s, side) { return ownedTiles(s, side).length; }
  function suppliedLandCount(s, side) { return landCount(s, side); }
  function computeSupply(s) { var a = new Uint8Array(s.tiles.length); s.tiles.forEach(function (t, i) { if (t.land && (t.owner === 1 || t.owner === 2)) a[i] = t.owner; }); return a; }
  function laneOf(s, i) { var t = s.tiles[i]; if (t && t.route === 'north') return 'NORTH'; if (t && t.route === 'south') return 'SOUTH'; return ((i / s.W) | 0) < s.H / 2 ? 'NORTH' : 'SOUTH'; }
  function orderLane(s, o) { return o && o.to != null ? laneOf(s, o.to) : null; }
  function adjacentOwned(s, side, to) { return neighbors(s, to).some(function (n) { return s.tiles[n].land && s.tiles[n].owner === side; }); }
  function canExpand(s, side, to, planned) {
    var t = s.tiles[to]; if (!t || !t.land || t.owner !== 0) return null;
    var direct = neighbors(s, to).filter(function (n) { return s.tiles[n].owner === side; })[0];
    if (direct != null) return direct;
    for (var i = 0; i < (planned || []).length; i++) if (planned[i].type === 'expand' && neighbors(s, to).indexOf(planned[i].to) >= 0) return planned[i].to;
    return null;
  }
  function canRaid(s, side, to) { var t = s.tiles[to]; if(t&&t.capital&&s.turn<=2)return null; return t && t.land && t.owner && t.owner !== side && adjacentOwned(s, side, to) ? neighbors(s, to).filter(function (n) { return s.tiles[n].owner === side; })[0] : null; }
  function raidSources(s, side, to) { return neighbors(s, to).filter(function (n) { return s.tiles[n].owner === side; }); }
  function canGuard(s, side, to) { var t = s.tiles[to]; return t && t.land && t.owner === side ? to : null; }
  function canFortify(s, side, to) { return canGuard(s, side, to); }
  function isFieldAction(type) { return type === 'expand' || type === 'raid' || type === 'guard'; }
  function commandPreview(state, side, orders) {
    var list = (orders || []).filter(function (o) { return o && isFieldAction(o.type); });
    return { side: side, ok: list.length <= COMMANDS_PER_TURN, reason: list.length > COMMANDS_PER_TURN ? 'Only two commands fit in one sealed envelope.' : null, commands: Math.min(list.length, 2), boosts: 0, tokensAvailable: 0, tokensRemaining: 0 };
  }

  function resolveTurn(state, aOrders, bOrders) {
    var s = U.deepClone(state), start = U.deepClone(state), fx = [];
    var accepted = { 1: [], 2: [] }, inputs = { 1: aOrders || [], 2: bOrders || [] };
    [1, 2].forEach(function (side) {
      var expanded = {}, guarded = {};
      inputs[side].some(function (raw) {
        if (accepted[side].length >= 2) return true;
        if (!raw || !isFieldAction(raw.type) || raw.to == null) return false;
        var from = null;
        if (raw.type === 'expand') { if (expanded[raw.to]) return false; from = canExpand(start, side, raw.to, accepted[side]); if (from == null) return false; expanded[raw.to] = true; }
        if (raw.type === 'raid') { from = canRaid(start, side, raw.to); if (from == null) return false; }
        if (raw.type === 'guard') { if (guarded[raw.to] || canGuard(start, side, raw.to) == null) return false; from = raw.to; guarded[raw.to] = true; }
        accepted[side].push({ type: raw.type, from: from, to: raw.to, side: side, depth: raw.type === 'expand' && start.tiles[from].owner !== side ? 2 : 1 });
        return false;
      });
    });

    var guards = { 1: {}, 2: {} }, raids = {};
    [1, 2].forEach(function (side) { accepted[side].forEach(function (o) {
      if (o.type === 'guard') guards[side][o.to] = 1;
      if (o.type === 'raid') { var key = side + ':' + o.to; raids[key] = (raids[key] || 0) + 1; }
    }); });

    var flips = [], capitalsFallen = { 1: false, 2: false };
    Object.keys(raids).forEach(function (key) {
      var parts = key.split(':'), side = +parts[0], to = +parts[1], defender = side === 1 ? 2 : 1;
      var effective = Math.max(0, raids[key] - (guards[defender][to] || 0));
      var needed = start.tiles[to].capital ? 2 : 1;
      if (effective >= needed) { flips.push({ at: to, side: side }); if (start.tiles[to].capital) capitalsFallen[defender] = true; }
      else fx.push({ kind: 'repel', at: to, side: side });
    });
    flips.forEach(function (f) { s.tiles[f.at].owner = f.side; s.tiles[f.at].str = 1; fx.push({ kind: 'capture', at: f.at, side: f.side }); });
    accepted[1].concat(accepted[2]).filter(function (o) { return o.type === 'guard'; }).forEach(function (o) { fx.push({ kind: 'fortify', at: o.to, side: o.side }); });

    var expands = accepted[1].concat(accepted[2]).filter(function (o) { return o.type === 'expand'; });
    [1, 2].forEach(function (depth) {
      var claims = {};
      expands.filter(function (o) { return o.depth === depth; }).forEach(function (o) {
        if (depth === 2 && s.tiles[o.from].owner !== o.side) return;
        (claims[o.to] || (claims[o.to] = [])).push(o);
      });
      Object.keys(claims).forEach(function (k) {
        var at = +k, sides = {}; claims[k].forEach(function (o) { sides[o.side] = true; });
        if (s.tiles[at].owner !== 0) return;
        var keys = Object.keys(sides); if (keys.length !== 1) { fx.push({ kind: 'clash', at: at }); return; }
        var side = +keys[0]; s.tiles[at].owner = side; s.tiles[at].str = 1; fx.push({ kind: depth === 2 ? 'surge' : 'settle', at: at, side: side });
      });
    });

    var holder = s.tiles[s.beacon] && s.tiles[s.beacon].owner;
    if (holder === 1 || holder === 2) { s.bp[holder]++; fx.push({ kind: 'beaconTick', at: s.beacon, side: holder }); }
    s.supply = computeSupply(s);
    var stat = { turn: s.turn, landA: landCount(s, 1), landB: landCount(s, 2), suppliedLandA:landCount(s,1), suppliedLandB:landCount(s,2), cutOffA:0, cutOffB:0,
      beacon: holder || 0, beaconTile: s.beacon, tokensSpent:{1:0,2:0}, tokensGenerated:{1:0,2:0},
      military:{1:accepted[1].filter(function(o){return o.type!=='expand';}).length,2:accepted[2].filter(function(o){return o.type!=='expand';}).length},
      captures: flips.length, territoryChanged: flips.length > 0 || expands.some(function (o) { return s.tiles[o.to].owner === o.side; }),
      settledOrders: { 1: accepted[1], 2: accepted[2] } };
    s.stats.push(stat);
    if (capitalsFallen[1] && capitalsFallen[2]) s.over = { winner: 0, why: 'Both capitals fell in the same sealed turn.' };
    else if (capitalsFallen[1]) s.over = { winner: 2, why: 'The Ashfarer capital has fallen.' };
    else if (capitalsFallen[2]) s.over = { winner: 1, why: 'The Saltkin capital has fallen.' };
    if (!s.over) s.over = checkVictory(s, false);
    return { state: s, fx: fx, tokensBefore: {1:0,2:0}, tokensSpent:{1:0,2:0}, tokensGenerated:{1:0,2:0}, tokensAfter:{1:0,2:0} };
  }

  function checkVictory(s, includeLimit) {
    if (s.bp[1] >= BEACON_TO_WIN) return { winner: 1, why: 'The Ashfarers reached four Beacon points.' };
    if (s.bp[2] >= BEACON_TO_WIN) return { winner: 2, why: 'The Saltkin reached four Beacon points.' };
    if (includeLimit !== false && s.stats.length >= MAX_TURNS) {
      if (s.bp[1] !== s.bp[2]) { var p = s.bp[1] > s.bp[2] ? 1 : 2; return { winner: p, why: 'Ten turns: ' + SIDE[p] + ' lead the Beacon score.' }; }
      var a = landCount(s, 1), b = landCount(s, 2); if (a !== b) { var w = a > b ? 1 : 2; return { winner: w, why: 'Ten turns: ' + SIDE[w] + ' hold more territory.' }; }
      return { winner: 0, why: 'Ten turns end level.' };
    }
    return null;
  }
  function coord(s, i) { return String.fromCharCode(65 + i % s.W) + (((i / s.W) | 0) + 1); }
  return { SIDE:SIDE, MAX_TURNS:MAX_TURNS, BEACON_TO_WIN:BEACON_TO_WIN, COMMANDS_PER_TURN:2, FIELD_COMMANDS:2,
    TOKEN_CAP:0, MAX_STRENGTH:1, newGame:newGame, neighbors:neighbors, ownedTiles:ownedTiles, landCount:landCount,
    suppliedLandCount:suppliedLandCount, computeSupply:computeSupply, laneOf:laneOf, orderLane:orderLane,
    canExpand:canExpand, canRaid:canRaid, raidSources:raidSources, canGuard:canGuard, canFortify:canFortify,
    commandPreview:commandPreview, isMilitary:function(t){return t==='raid'||t==='guard';}, isFieldAction:isFieldAction,
    resolveTurn:resolveTurn, checkVictory:checkVictory, coord:coord,
    tokenSites:function(){return[];}, tokenIncome:function(){return 0;}, tokensAvailable:function(){return 0;},
    attackValue:function(){return 1;}, coordinatedAttackValue:function(){return 2;}, defenceValue:function(){return 1;}, highGround:function(){return 0;}, relayImpact:function(){return null;}
  };
})();
