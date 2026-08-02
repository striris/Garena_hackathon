/* ============================================================
   engine.js — the rules, and nothing else
   Two pure functions carry the whole game:
     resolveTurn(state, ordersA, ordersB) -> { state, fx }
     CF.events.apply(state, event)        -> { state, fx }
   No hidden state, no side effects. That buys us headless
   balance runs, exact replays, and undo, all for free.
   ============================================================ */
CF.engine = (function () {
  var U = CF.util, M = CF.mapgen;

  var COST = { expand: 2, fortify: 1, raid: 3 };
  var SIDE = { 1: 'Ashfarers', 2: 'Saltkin', 3: 'Settlers' };
  var MAX_TURNS = 25;
  var BEACON_TO_WIN = 10;

  // ---------------------------------------------------------------- setup
  function newGame(seed) {
    var m = M.generate(seed);
    var s = {
      W: m.W, H: m.H,
      tiles: m.tiles,
      capitals: m.capitals,
      beacon: m.beacon,
      turn: 1,
      bp: { 1: 0, 2: 0 },
      mods: { ashfall: 0, rockCooled: 0, storm: 0 },
      seed: m.seed,
      rngSeed: m.rngSeed,
      feed: [],
      chronicle: [],
      stats: [],
      memory: {},          // template -> { uses, hits, misses }
      lastTemplate: null,
      targetHistory: [],   // which side each season mainly hit
      pending: null,       // the warned-but-not-yet-fired event
      season: 0,
      over: null
    };
    s.supply = computeSupply(s);
    return s;
  }

  function raidCost(state) { return state.mods.ashfall > 0 ? COST.raid * 2 : COST.raid; }
  function costOf(state, type) { return type === 'raid' ? raidCost(state) : COST[type]; }

  // ------------------------------------------------------------- geometry
  function neighbors(state, i) {
    var W = state.W, H = state.H, x = i % W, y = (i / W) | 0, out = [];
    if (x > 0) out.push(i - 1);
    if (x < W - 1) out.push(i + 1);
    if (y > 0) out.push(i - W);
    if (y < H - 1) out.push(i + W);
    return out;
  }

  function ownedTiles(state, side) {
    var out = [];
    for (var i = 0; i < state.tiles.length; i++)
      if (state.tiles[i].owner === side && state.tiles[i].land) out.push(i);
    return out;
  }

  function landCount(state, side) { return ownedTiles(state, side).length; }

  // --------------------------------------------------------------- supply
  // A square only counts if you can trace your own land back to your capital.
  // One flood fill. It is also what makes an earthquake frightening.
  function computeSupply(state) {
    var sup = new Uint8Array(state.tiles.length);
    [1, 2].forEach(function (side) {
      var cap = state.capitals[side];
      if (cap == null) return;
      var t = state.tiles[cap];
      if (!t || t.owner !== side || !t.land) return;
      var stack = [cap], seen = {};
      seen[cap] = 1;
      while (stack.length) {
        var i = stack.pop();
        sup[i] = side;
        var ns = neighbors(state, i);
        for (var k = 0; k < ns.length; k++) {
          var n = ns[k];
          if (seen[n]) continue;
          var nt = state.tiles[n];
          if (nt.land && nt.owner === side) { seen[n] = 1; stack.push(n); }
        }
      }
    });
    return sup;
  }

  function income(state, side) {
    var total = 0;
    for (var i = 0; i < state.tiles.length; i++) {
      var t = state.tiles[i];
      if (t.owner === side && t.land && state.supply[i] === side) total += t.fert;
    }
    return total;
  }

  // --------------------------------------------------------------- combat
  // One comparison. No dice, no unit types. All the surprise in this game
  // comes from the mountain, not from luck here.
  function stormSwing(state, side) {
    if (state.mods.storm <= 0) return 0;
    var a = landCount(state, 1), b = landCount(state, 2);
    if (a === b) return 0;
    var losing = a < b ? 1 : 2;
    return side === losing ? 2 : -1;
  }

  function attackValue(state, fromIdx, side) {
    return state.tiles[fromIdx].str + 3 + stormSwing(state, side);
  }

  function defenceValue(state, tileIdx) {
    var t = state.tiles[tileIdx];
    return t.str + (state.mods.rockCooled > 0 ? 0 : t.elev);
  }

  // ------------------------------------------------------- order legality
  function canExpand(state, side, to) {
    var t = state.tiles[to];
    if (!t.land || t.owner !== 0) return null;
    var ns = neighbors(state, to);
    for (var k = 0; k < ns.length; k++)
      if (state.tiles[ns[k]].owner === side && state.tiles[ns[k]].land) return ns[k];
    return null;
  }

  function canFortify(state, side, to) {
    var t = state.tiles[to];
    return (t.land && t.owner === side) ? to : null;
  }

  // returns the best source square for a raid, or null
  function canRaid(state, side, to) {
    var t = state.tiles[to];
    if (!t.land || t.owner === side || t.owner === 0) return null;
    var ns = neighbors(state, to), best = null, bestStr = -1;
    for (var k = 0; k < ns.length; k++) {
      var n = ns[k], nt = state.tiles[n];
      if (nt.land && nt.owner === side && nt.str > bestStr) { bestStr = nt.str; best = n; }
    }
    return best;
  }

  function resolveSource(state, side, order) {
    if (order.type === 'expand') return canExpand(state, side, order.to);
    if (order.type === 'fortify') return canFortify(state, side, order.to);
    if (order.type === 'raid') return canRaid(state, side, order.to);
    return null;
  }

  // --------------------------------------------------------- turn resolve
  // Both sides give orders at the same time, in secret, and everything
  // resolves together. Attack strengths are read from a single snapshot so
  // neither side benefits from being processed first.
  function resolveTurn(state, ordersA, ordersB) {
    var s = U.deepClone(state);
    s.supply = computeSupply(s);
    var fx = [];
    var line = [];

    var budget = { 1: income(s, 1), 2: income(s, 2) };
    var spent = { 1: 0, 2: 0 };
    var accepted = { 1: [], 2: [] };

    // trim each side's orders to what it can actually pay for
    [[1, ordersA], [2, ordersB]].forEach(function (pair) {
      var side = pair[0], list = pair[1] || [];
      for (var k = 0; k < list.length; k++) {
        var o = list[k];
        var c = costOf(s, o.type);
        if (spent[side] + c > budget[side]) continue;
        var from = resolveSource(s, side, o);
        if (from == null) continue;
        spent[side] += c;
        accepted[side].push({ type: o.type, from: from, to: o.to, side: side });
      }
    });

    var all = accepted[1].concat(accepted[2]);

    // --- 1. raids ----------------------------------------------------------
    // Every raid is judged against one frozen snapshot of the board and only
    // then applied. Resolving them one at a time looks equivalent and is not:
    // an earlier version walked targets in index order, so the side whose
    // territory sat at low indices always had its losses applied first and
    // could invalidate the other side's attacks. That handed the Saltkin
    // three matches in four. Simultaneous has to mean simultaneous.
    var snapStr = s.tiles.map(function (t) { return t.str; });
    var snapOwner = s.tiles.map(function (t) { return t.owner; });
    var raids = all.filter(function (o) { return o.type === 'raid'; });

    var raidCounts = { 1: 0, 2: 0 }, captures = { 1: 0, 2: 0 };
    var byTarget = {};

    raids.forEach(function (o) {
      if (snapOwner[o.from] !== o.side) return;
      if (!s.tiles[o.to].land || snapOwner[o.to] === o.side) return;
      raidCounts[o.side]++;
      (byTarget[o.to] || (byTarget[o.to] = [])).push(o);
    });

    var strDelta = {};                       // applied only after every fight
    function hit(i, d) { strDelta[i] = (strDelta[i] || 0) + d; }
    var flips = [];

    Object.keys(byTarget).forEach(function (key) {
      var target = +key, group = byTarget[key];
      var dst = s.tiles[target];
      var def = snapStr[target] + (s.mods.rockCooled > 0 ? 0 : dst.elev);

      // where several attacks land on one square, the heaviest decides it
      var best = null, bestAtk = -Infinity;
      group.forEach(function (o) {
        var atk = snapStr[o.from] + 3 + stormSwing(s, o.side);
        if (atk > bestAtk || (atk === bestAtk && best && o.from < best.from)) { bestAtk = atk; best = o; }
      });

      if (bestAtk > def) {
        flips.push({ at: target, side: best.side, from: best.from, loser: snapOwner[target] });
        hit(best.from, -2);
      } else {
        hit(target, -1);
        group.forEach(function (o) {
          fx.push({ kind: 'repel', at: target, from: o.from, side: o.side });
        });
        line.push({ cls: side2cls(best.side),
          text: SIDE[best.side] + ' break on ' + coord(s, target) + ' (' + bestAtk + ' vs ' + def + ').' });
      }
    });

    Object.keys(strDelta).forEach(function (k) {
      var t = s.tiles[+k];
      t.str = Math.max(0, t.str + strDelta[k]);
    });

    flips.forEach(function (f) {
      var dst = s.tiles[f.at];
      var wasCapital = dst.capital;
      dst.owner = f.side;
      dst.str = 1;
      captures[f.side]++;
      fx.push({ kind: 'capture', at: f.at, from: f.from, side: f.side });
      line.push({ cls: side2cls(f.side),
        text: SIDE[f.side] + ' take ' + coord(s, f.at) + (f.loser ? ' from the ' + SIDE[f.loser] : '') + '.' });
      if (wasCapital) {
        dst.capital = 0;
        s.over = { winner: f.side, why: 'The ' + SIDE[f.loser] + ' capital has fallen.' };
      }
    });

    // --- 2. expansion ------------------------------------------------------
    // When both peoples reach for the same empty square, the one who brought
    // more people to its edge holds it. An earlier version had them bounce
    // off each other and leave the land empty, which reads well but deadlocks:
    // on a ring the two chokepoints are one square wide, so both sides would
    // reach for the same square every turn forever and never once touch.
    var expands = all.filter(function (o) { return o.type === 'expand'; });
    var claimBy = {};
    expands.forEach(function (o) {
      if (!(o.to in claimBy)) claimBy[o.to] = o.side;
      else if (claimBy[o.to] !== o.side) claimBy[o.to] = -1;   // contested
    });
    Object.keys(claimBy).forEach(function (key) {
      var i = +key, side = claimBy[key], t = s.tiles[i];
      if (!t.land || t.owner !== 0) return;

      if (side === -1) {
        var weight = { 1: 0, 2: 0 };
        var ns = neighbors(s, i);
        for (var q = 0; q < ns.length; q++) {
          var nt = s.tiles[ns[q]];
          if (nt.land && (nt.owner === 1 || nt.owner === 2)) weight[nt.owner] += nt.str;
        }
        if (weight[1] === weight[2]) {
          // dead level: the square goes to whoever holds less of the ring,
          // so a contested chokepoint never freezes the map. If even that
          // ties, alternate by turn rather than always favouring one people.
          var la = landCount(s, 1), lb = landCount(s, 2);
          side = la === lb ? (s.turn % 2 ? 1 : 2) : (la < lb ? 1 : 2);
        } else {
          side = weight[1] > weight[2] ? 1 : 2;
        }
        fx.push({ kind: 'clash', at: i });
        line.push({ cls: side2cls(side), text: 'Both peoples reach ' + coord(s, i) +
          '. The ' + SIDE[side] + ' brought more and hold it.' });
      }

      t.owner = side; t.str = 1;
      fx.push({ kind: 'settle', at: i, side: side });
    });

    // --- 3. fortify -------------------------------------------------------
    all.filter(function (o) { return o.type === 'fortify'; }).forEach(function (o) {
      var t = s.tiles[o.to];
      if (t.owner !== o.side) return;
      t.str += 2;
      fx.push({ kind: 'fortify', at: o.to, side: o.side });
    });

    // --- 4. supply and starvation ----------------------------------------
    s.supply = computeSupply(s);
    var starved = 0;
    for (var i = 0; i < s.tiles.length; i++) {
      var t = s.tiles[i];
      if (!t.land || t.owner === 0 || t.owner === 3) continue;
      if (t.capital) continue;
      if (s.supply[i] !== t.owner) {
        t.str -= 1;
        starved++;
        if (t.str <= 0) {
          t.owner = 0; t.str = 0;
          fx.push({ kind: 'starve', at: i });
        }
      }
    }
    if (starved) line.push({ cls: '', text: U.plural(starved, 'square') + ' cut off from home are wasting away.' });
    s.supply = computeSupply(s);

    // --- 5. the Beacon ----------------------------------------------------
    var bt = s.tiles[s.beacon];
    var holder = (bt && bt.land && (bt.owner === 1 || bt.owner === 2)) ? bt.owner : 0;
    if (holder) {
      s.bp[holder] += 1;
      fx.push({ kind: 'beaconTick', at: s.beacon, side: holder });
      line.push({ cls: 'beacon', text: 'The Beacon burns for the ' + SIDE[holder] + '. (' + s.bp[holder] + '/' + BEACON_TO_WIN + ')' });
    }

    // --- 6. modifiers tick down ------------------------------------------
    ['ashfall', 'rockCooled', 'storm'].forEach(function (k) {
      if (s.mods[k] > 0) {
        s.mods[k]--;
        if (s.mods[k] === 0) line.push({ cls: 'world', text: modEnd(k) });
      }
    });

    // --- 7. bookkeeping ---------------------------------------------------
    s.stats.push({
      turn: s.turn,
      raids: raidCounts[1] + raidCounts[2],
      captures: captures[1] + captures[2],
      landA: landCount(s, 1),
      landB: landCount(s, 2),
      beacon: holder
    });

    line.forEach(function (l) { s.feed.push({ turn: s.turn, cls: l.cls || '', text: l.text }); });

    // --- 8. victory -------------------------------------------------------
    if (!s.over) s.over = checkVictory(s);

    return { state: s, fx: fx, spent: spent, budget: budget };
  }

  function checkVictory(s) {
    if (s.bp[1] >= BEACON_TO_WIN) return { winner: 1, why: 'The Ashfarers held the fire long enough to claim the ring.' };
    if (s.bp[2] >= BEACON_TO_WIN) return { winner: 2, why: 'The Saltkin held the fire long enough to claim the ring.' };
    var a = landCount(s, 1), b = landCount(s, 2);
    if (a < 1) return { winner: 2, why: 'The Ashfarers have no ground left.' };
    if (b < 1) return { winner: 1, why: 'The Saltkin have no ground left.' };
    if (s.turn >= MAX_TURNS) {
      if (a === b) return { winner: 0, why: 'Twenty-five turns, and the ring is split exactly. The mountain is unimpressed.' };
      return { winner: a > b ? 1 : 2, why: 'Twenty-five turns. ' + (a > b ? 'The Ashfarers' : 'The Saltkin') + ' hold the most ground: ' + Math.max(a, b) + ' to ' + Math.min(a, b) + '.' };
    }
    return null;
  }

  function modEnd(k) {
    return k === 'ashfall' ? 'The sky opens again. Raids cost what they should.'
         : k === 'rockCooled' ? 'The rock hardens. High ground shelters its holders once more.'
         : 'The storm season passes.';
  }

  // ----------------------------------------------------------------- misc
  function coord(state, i) {
    var x = i % state.W, y = (i / state.W) | 0;
    return String.fromCharCode(65 + x) + (y + 1);
  }
  function side2cls(s) { return s === 1 ? 'a' : s === 2 ? 'b' : ''; }

  return {
    COST: COST, SIDE: SIDE, MAX_TURNS: MAX_TURNS, BEACON_TO_WIN: BEACON_TO_WIN,
    newGame: newGame, neighbors: neighbors, ownedTiles: ownedTiles, landCount: landCount,
    computeSupply: computeSupply, income: income, resolveTurn: resolveTurn,
    canExpand: canExpand, canFortify: canFortify, canRaid: canRaid,
    attackValue: attackValue, defenceValue: defenceValue, stormSwing: stormSwing,
    costOf: costOf, raidCost: raidCost, coord: coord, checkVictory: checkVictory
  };
})();
