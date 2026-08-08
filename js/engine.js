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

  var COST = { expand: 2, fortify: 2, raid: 3 };
  var FIELD_COMMANDS = 2;
  var EFFORT_HORIZON = 3;
  var MOBILIZATION_COST = 2;
  var SUPPORT_COST = 2;
  var RESERVE_CAP = 6;
  var FORTIFY_GAIN = 1;
  var MAX_STRENGTH = 6;
  var SYNERGY_BONUS = 2;
  var SIEGE_SUPPORT_BONUS = 1;
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
      relays: m.relays,
      pressureBridge: m.pressureBridge,
      opening: { route: m.openingFocus, untilTurn: 4, fertilityBonus: 1 },
      turn: 1,
      bp: { 1: 0, 2: 0 },
      reserve: { 1: 0, 2: 0 },
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
      strategy: { 1: null, 2: null },
      pressure: { staleTurns: 0, warned: false, bridgeTurns: 0, lastOpenedTurn: -99 },
      over: null
    };
    s.supply = computeSupply(s);
    return s;
  }

  function raidCost(state) { return state.mods.ashfall > 0 ? COST.raid * 2 : COST.raid; }
  function costOf(state, type) { return type === 'raid' ? raidCost(state) : COST[type]; }
  function isMilitary(type) { return type === 'raid' || type === 'fortify'; }
  function isFieldAction(type) { return type === 'expand' || type === 'raid' || type === 'fortify'; }

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

  function laneOf(state, i) {
    var t = state.tiles[i];
    if (t && t.route === 'north') return 'NORTH';
    if (t && t.route === 'south') return 'SOUTH';
    return ((i / state.W) | 0) < state.H / 2 ? 'NORTH' : 'SOUTH';
  }

  function orderLane(state, order) {
    if (!order) return null;
    var target = state.tiles[order.to];
    if (target && (target.route === 'north' || target.route === 'south')) return laneOf(state, order.to);
    if (order.from != null && state.tiles[order.from]) return laneOf(state, order.from);
    return target ? laneOf(state, order.to) : null;
  }

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
      if (t.owner === side && t.land && state.supply[i] === side) {
        total += t.fert;
        if (state.opening && state.turn <= state.opening.untilTurn && !t.capital &&
            laneOf(state, i) === state.opening.route) total += state.opening.fertilityBonus || 0;
      }
    }
    return total;
  }

  function availableBudget(state, side) {
    return income(state, side) + (state.reserve && state.reserve[side] || 0);
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

  function coordinatedAttackValue(state, sources, side) {
    var unique = {}, supplied = 0, best = -Infinity;
    (sources || []).forEach(function (from) {
      if (unique[from] || !state.tiles[from] || state.tiles[from].owner !== side) return;
      unique[from] = true;
      best = Math.max(best, attackValue(state, from, side));
      if (state.supply[from] === side) supplied++;
    });
    if (best === -Infinity) return -Infinity;
    return best + (supplied >= 2 ? SYNERGY_BONUS : 0);
  }

  // ------------------------------------------------------- order legality
  function canExpand(state, side, to, planned) {
    var t = state.tiles[to];
    if (!t.land || t.owner !== 0) return null;
    var ns = neighbors(state, to);
    for (var k = 0; k < ns.length; k++)
      if (state.tiles[ns[k]].owner === side && state.tiles[ns[k]].land) return ns[k];
    // The second field command may continue through a square claimed by an
    // earlier queued Expand. Resolution keeps the dependency: if the first
    // claim loses a simultaneous contest, the follow-through also fails.
    for (var p = 0; p < (planned || []).length; p++) {
      var o = planned[p];
      if (o.type === 'expand' && ns.indexOf(o.to) >= 0) return o.to;
    }
    return null;
  }

  function canFortify(state, side, to) {
    var t = state.tiles[to];
    return (t.land && t.owner === side && state.supply[to] === side && t.str < MAX_STRENGTH) ? to : null;
  }

  function raidSources(state, side, to) {
    var t = state.tiles[to];
    if (!t.land || t.owner === side || t.owner === 0) return [];
    var ns = neighbors(state, to), out = [];
    for (var k = 0; k < ns.length; k++) {
      var n = ns[k], nt = state.tiles[n];
      if (nt.land && nt.owner === side) out.push(n);
    }
    out.sort(function (a, b) { return state.tiles[b].str - state.tiles[a].str || a - b; });
    return out;
  }

  // Returns the strongest unused source square for a raid, or null. Passing
  // exclusions lets a second command approach the same target from another
  // supplied square and earn the coordination bonus.
  function canRaid(state, side, to, excluded) {
    var blocked = {};
    (excluded || []).forEach(function (i) { blocked[i] = true; });
    var sources = raidSources(state, side, to);
    for (var i = 0; i < sources.length; i++) if (!blocked[sources[i]]) return sources[i];
    return null;
  }

  function resolveSource(state, side, order, usedRaidSources, provisionalExpands) {
    if (order.type === 'expand') {
      var direct = canExpand(state, side, order.to);
      if (direct != null) return { from: direct, depth: 1 };
      var ns = neighbors(state, order.to), best = null;
      for (var n = 0; n < ns.length; n++) {
        var prior = provisionalExpands[ns[n]];
        if (prior && (best == null || prior.depth < best.depth ||
            (prior.depth === best.depth && ns[n] < best.from))) {
          best = { from: ns[n], depth: prior.depth + 1 };
        }
      }
      return best;
    }
    if (order.type === 'fortify') return canFortify(state, side, order.to);
    if (order.type === 'raid') {
      var sources = raidSources(state, side, order.to);
      var used = usedRaidSources[order.to] || [];
      if (order.from != null && sources.indexOf(order.from) >= 0 && used.indexOf(order.from) < 0) return order.from;
      return canRaid(state, side, order.to, used);
    }
    return null;
  }

  function commandContext(state, side) {
    var current = state.strategy && state.strategy[side];
    return {
      side: side,
      main: current && current.main || null,
      issuedTurn: current && current.issuedTurn || 0,
      untilTurn: current && current.untilTurn || 0,
      locked: !!(current && current.untilTurn >= state.turn),
      committed: false,
      commands: 0,
      redeploys: 0,
      mobilizationCost: 0,
      ok: true,
      reason: null
    };
  }

  function commitFieldCommand(state, ctx, lane) {
    if (!lane) return { ok: false, reason: 'This order is not on a recognised route.' };
    var cost = 1, redeployed = false;
    var main = ctx.main, issuedTurn = ctx.issuedTurn, untilTurn = ctx.untilTurn;
    var locked = ctx.locked, committed = ctx.committed;
    if (!main) {
      main = lane;
      issuedTurn = state.turn;
      untilTurn = state.turn + EFFORT_HORIZON - 1;
      locked = true;
      committed = true;
    } else if (!locked) {
      if (lane !== main) { cost++; redeployed = true; }
      main = lane;
      issuedTurn = state.turn;
      untilTurn = state.turn + EFFORT_HORIZON - 1;
      locked = true;
      committed = true;
    } else if (lane !== main) {
      return {
        ok: false,
        reason: 'Main effort is locked to ' + main + ' through turn ' + untilTurn + '.'
      };
    }
    if (ctx.commands + cost > FIELD_COMMANDS) {
      return {
        ok: false,
        reason: redeployed
          ? 'Redeploying and acting costs both field commands.'
          : 'Both field commands are already committed.'
      };
    }
    var mobilization = ctx.commands < FIELD_COMMANDS && ctx.commands + cost >= FIELD_COMMANDS
      ? MOBILIZATION_COST : 0;
    ctx.main = main;
    ctx.issuedTurn = issuedTurn;
    ctx.untilTurn = untilTurn;
    ctx.locked = locked;
    ctx.committed = committed;
    ctx.commands += cost;
    ctx.mobilizationCost += mobilization;
    if (redeployed) ctx.redeploys++;
    return { ok: true, cost: cost, redeployed: redeployed, mobilizationCost: mobilization };
  }

  // UI and bots use the same deterministic command calculation as resolution.
  // It deliberately checks command/lane structure only; the normal order
  // helpers remain authoritative for adjacency, supply, and target ownership.
  function commandPreview(state, side, orders) {
    var ctx = commandContext(state, side);
    for (var i = 0; i < (orders || []).length; i++) {
      var order = orders[i];
      if (!isFieldAction(order.type)) continue;
      var result = commitFieldCommand(state, ctx, orderLane(state, order));
      if (!result.ok) {
        ctx.ok = false;
        ctx.reason = result.reason;
        return ctx;
      }
    }
    return ctx;
  }

  function supportType(state, side, orders) {
    var list = orders || [];
    var expands = list.filter(function (o) { return o.type === 'expand'; });
    for (var i = 0; i < expands.length; i++) {
      for (var j = 0; j < i; j++) {
        if (expands[i].from === expands[j].to && orderLane(state, expands[i]) === orderLane(state, expands[j]))
          return 'march';
      }
    }
    var raidGroups = {};
    list.filter(function (o) { return o.type === 'raid'; }).forEach(function (o) {
      (raidGroups[o.to] || (raidGroups[o.to] = [])).push(o);
    });
    var targets = Object.keys(raidGroups);
    for (var t = 0; t < targets.length; t++) {
      var group = raidGroups[targets[t]], sources = {};
      group.forEach(function (o) {
        if (state.tiles[o.from] && state.tiles[o.from].owner === side && state.supply[o.from] === side)
          sources[o.from] = true;
      });
      if (Object.keys(sources).length >= 2) return 'siege';
    }
    return null;
  }

  function planCost(state, side, orders, requestSupport) {
    var command = commandPreview(state, side, orders);
    var base = (orders || []).reduce(function (sum, order) {
      var cost = costOf(state, order.type);
      return sum + (cost == null ? 0 : cost);
    }, 0);
    var support = requestSupport && supportType(state, side, orders) ? SUPPORT_COST : 0;
    return {
      ok: command.ok,
      reason: command.reason,
      commands: command.commands,
      redeploys: command.redeploys,
      base: base,
      mobilization: command.mobilizationCost,
      support: support,
      supportType: support ? supportType(state, side, orders) : null,
      total: base + command.mobilizationCost + support
    };
  }

  // --------------------------------------------------------- turn resolve
  // Both sides give orders at the same time, in secret, and everything
  // resolves together. Attack strengths are read from a single snapshot so
  // neither side benefits from being processed first.
  function resolveTurn(state, ordersA, ordersB) {
    var s = U.deepClone(state);
    s.supply = computeSupply(s);
    s.strategy = s.strategy || { 1: null, 2: null };
    s.reserve = s.reserve || { 1: 0, 2: 0 };
    s.pressure = s.pressure || { staleTurns: 0, warned: false, bridgeTurns: 0, lastOpenedTurn: -99 };
    var fx = [];
    var line = [];
    var territoryChanged = false;
    var bridgeWasActive = s.pressure.bridgeTurns > 0;

    var turnIncome = { 1: income(s, 1), 2: income(s, 2) };
    var reserveBefore = { 1: s.reserve[1] || 0, 2: s.reserve[2] || 0 };
    var budget = {
      1: turnIncome[1] + reserveBefore[1],
      2: turnIncome[2] + reserveBefore[2]
    };
    var spent = { 1: 0, 2: 0 };
    var accepted = { 1: [], 2: [] };
    var militaryUsed = { 1: 0, 2: 0 };
    var fieldUsed = { 1: 0, 2: 0 };
    var redeploys = { 1: 0, 2: 0 };
    var mobilizationSpent = { 1: 0, 2: 0 };
    var supportBySide = { 1: null, 2: null };

    function cutOffCount(side) {
      var count = 0;
      for (var ci = 0; ci < s.tiles.length; ci++) {
        var ct = s.tiles[ci];
        if (ct.land && ct.owner === side && s.supply[ci] !== side) count++;
      }
      return count;
    }
    var cutBefore = { 1: cutOffCount(1), 2: cutOffCount(2) };

    // Every territorial action uses field command. The first accepted action
    // establishes a three-turn main effort. Once that lock expires, changing
    // route spends an additional command on redeployment, leaving room for
    // only one action that turn.
    [[1, ordersA], [2, ordersB]].forEach(function (pair) {
      var side = pair[0], list = pair[1] || [];
      var fortified = {};
      var usedRaidSources = {};
      var expandedTo = {};
      var provisionalExpands = {};
      var commands = commandContext(s, side);
      for (var k = 0; k < list.length; k++) {
        var o = list[k];
        var c = costOf(s, o.type);
        if (c == null) continue;
        if (o.type === 'fortify' && fortified[o.to]) continue;
        if (o.type === 'expand' && expandedTo[o.to]) continue;
        var source = resolveSource(s, side, o, usedRaidSources, provisionalExpands);
        if (source == null) continue;
        var from = o.type === 'expand' ? source.from : source;
        var nextCommands = Object.assign({}, commands);
        var command = commitFieldCommand(s, nextCommands, orderLane(s, { type: o.type, from: from, to: o.to }));
        if (!command.ok) continue;
        var orderCost = c + command.mobilizationCost;
        if (spent[side] + orderCost > budget[side]) continue;
        commands = nextCommands;
        spent[side] += orderCost;
        mobilizationSpent[side] += command.mobilizationCost;
        var acceptedOrder = {
          type: o.type, from: from, to: o.to, side: side,
          baseCost: c, mobilizationCost: command.mobilizationCost
        };
        if (o.type === 'expand') acceptedOrder.depth = source.depth;
        accepted[side].push(acceptedOrder);
        if (isMilitary(o.type)) militaryUsed[side]++;
        if (o.type === 'fortify') fortified[o.to] = true;
        if (o.type === 'raid') (usedRaidSources[o.to] || (usedRaidSources[o.to] = [])).push(from);
        if (o.type === 'expand') {
          expandedTo[o.to] = true;
          provisionalExpands[o.to] = { depth: source.depth };
        }
        if (command.redeployed) {
          line.push({ cls: side2cls(side), text: SIDE[side] + ' redeploy their main effort to the ' + commands.main + ' route.' });
        }
      }
      fieldUsed[side] = commands.commands;
      redeploys[side] = commands.redeploys;
      var support = supportType(s, side, accepted[side]);
      if (list.support && support && spent[side] + SUPPORT_COST <= budget[side]) {
        supportBySide[side] = support;
        spent[side] += SUPPORT_COST;
        line.push({ cls: side2cls(side), text: SIDE[side] + (support === 'march'
          ? ' fund march supply for a stronger follow-through.'
          : ' bring siege support to their coordinated attack.') });
      }
      if (commands.committed) {
        s.strategy[side] = {
          main: commands.main,
          secondary: commands.main === 'NORTH' ? 'HOLD SOUTH' : 'HOLD NORTH',
          issuedTurn: commands.issuedTurn,
          untilTurn: commands.untilTurn
        };
      }
    });

    [1, 2].forEach(function (side) {
      var reserveUsed = Math.max(0, spent[side] - turnIncome[side]);
      var reserveLeft = Math.max(0, reserveBefore[side] - reserveUsed);
      var unspentIncome = Math.max(0, turnIncome[side] - spent[side]);
      s.reserve[side] = Math.min(RESERVE_CAP, reserveLeft + Math.floor(unspentIncome / 2));
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

    var raidCounts = { 1: 0, 2: 0 }, captures = { 1: 0, 2: 0 }, synergyAttacks = 0;
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

      // Commands from two distinct supplied sources combine into one attack.
      // A side therefore has to concentrate its entire military allowance to
      // earn +2; splitting north/south can hold both fronts but cannot breach.
      var bySide = {};
      group.forEach(function (o) { (bySide[o.side] || (bySide[o.side] = [])).push(o); });
      var contenders = [];
      Object.keys(bySide).forEach(function (sideKey) {
        var side = +sideKey, sideGroup = bySide[side];
        var best = sideGroup[0], base = -Infinity;
        sideGroup.forEach(function (o) {
          var atk = snapStr[o.from] + 3 + stormSwing(s, side);
          if (atk > base || (atk === base && o.from < best.from)) { base = atk; best = o; }
        });
        var suppliedSources = {};
        sideGroup.forEach(function (o) {
          if (s.supply[o.from] === side) suppliedSources[o.from] = true;
        });
        var coordinated = Object.keys(suppliedSources).length >= 2;
        var siegeSupported = coordinated && supportBySide[side] === 'siege';
        contenders.push({
          side: side, best: best, group: sideGroup,
          coordinated: coordinated, supported: siegeSupported,
          attack: base + (coordinated ? SYNERGY_BONUS : 0) + (siegeSupported ? SIEGE_SUPPORT_BONUS : 0)
        });
      });
      contenders.sort(function (a, b) {
        if (b.attack !== a.attack) return b.attack - a.attack;
        var al = landCount(s, a.side), bl = landCount(s, b.side);
        if (al !== bl) return al - bl;
        return (s.turn % 2 ? a.side - b.side : b.side - a.side);
      });
      var winner = contenders[0], best = winner.best, bestAtk = winner.attack;

      if (bestAtk > def) {
        flips.push({ at: target, side: winner.side, from: best.from, loser: snapOwner[target] });
        if (winner.coordinated) {
          synergyAttacks++;
          winner.group.forEach(function (o) { hit(o.from, -1); });
          fx.push({ kind: 'synergy', at: target, sources: winner.group.map(function (o) { return o.from; }), side: winner.side });
          line.push({ cls: side2cls(winner.side), text: SIDE[winner.side] + ' coordinate two supplied attacks on ' + coord(s, target) + ' (+' +
            (SYNERGY_BONUS + (winner.supported ? SIEGE_SUPPORT_BONUS : 0)) +
            (winner.supported ? ' with siege support' : '') + ').' });
        } else {
          hit(best.from, -2);
        }
      } else {
        hit(target, -1);
        winner.group.forEach(function (o) {
          fx.push({ kind: 'repel', at: target, from: o.from, side: o.side });
        });
        line.push({ cls: side2cls(winner.side),
          text: SIDE[winner.side] + ' break on ' + coord(s, target) + ' (' + bestAtk + ' vs ' + def + ').' });
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
      territoryChanged = true;
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
    var maxExpandDepth = expands.reduce(function (max, o) { return Math.max(max, o.depth || 1); }, 0);
    for (var depth = 1; depth <= maxExpandDepth; depth++) {
      var claimBy = {};
      expands.filter(function (o) { return (o.depth || 1) === depth; }).forEach(function (o) {
        // A follow-through only exists if its newly claimed source survived
        // the previous expansion layer.
        if (depth > 1 && (!s.tiles[o.from] || s.tiles[o.from].owner !== o.side)) return;
        if (!(o.to in claimBy)) claimBy[o.to] = o.side;
        else if (claimBy[o.to] !== o.side) claimBy[o.to] = -1;
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
            // Dead level: the square goes to whoever holds less of the ring;
            // if that also ties, initiative alternates by turn.
            var la = landCount(s, 1), lb = landCount(s, 2);
            side = la === lb ? (s.turn % 2 ? 1 : 2) : (la < lb ? 1 : 2);
          } else {
            side = weight[1] > weight[2] ? 1 : 2;
          }
          fx.push({ kind: 'clash', at: i });
          line.push({ cls: side2cls(side), text: 'Both peoples reach ' + coord(s, i) +
            '. The ' + SIDE[side] + ' brought more and hold it.' });
        }

        t.owner = side;
        t.str = depth > 1 && supportBySide[side] === 'march' ? 2 : 1;
        territoryChanged = true;
        fx.push({ kind: depth > 1 ? 'surge' : 'settle', at: i, side: side });
        if (depth > 1) line.push({ cls: side2cls(side), text: SIDE[side] + ' continue their advance into ' + coord(s, i) + '.' });
      });
    }

    // --- 3. fortify -------------------------------------------------------
    // Raids and expansion may have severed a Relay earlier in this same
    // simultaneous turn; recompute before allowing defensive work.
    s.supply = computeSupply(s);
    all.filter(function (o) { return o.type === 'fortify'; }).forEach(function (o) {
      var t = s.tiles[o.to];
      if (t.owner !== o.side || s.supply[o.to] !== o.side) return;
      t.str = Math.min(MAX_STRENGTH, t.str + FORTIFY_GAIN);
      fx.push({ kind: 'fortify', at: o.to, side: o.side });
    });

    // A temporary pressure bridge remains usable for two complete turns, then
    // cools back into the caldera before supply and starvation are evaluated.
    if (bridgeWasActive) {
      s.pressure.bridgeTurns--;
      if (s.pressure.bridgeTurns <= 0) {
        (s.pressureBridge || []).forEach(function (bi) {
          var bridgeTile = s.tiles[bi];
          if (!bridgeTile.temporaryBridge) return;
          if (bridgeTile.owner) territoryChanged = true;
          bridgeTile.land = false;
          bridgeTile.owner = 0;
          bridgeTile.str = 0;
          bridgeTile.elev = 0;
          bridgeTile.fert = 0;
          bridgeTile.crater = 0;
          bridgeTile.route = null;
          bridgeTile.bridge = null;
          bridgeTile.temporaryBridge = 0;
          bridgeTile.pressureReserved = 1;
          fx.push({ kind: 'sink', at: bi });
        });
        line.push({ cls: 'world', text: 'The temporary Cinder crossing sinks back into the caldera.' });
      }
    }

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
          territoryChanged = true;
          fx.push({ kind: 'starve', at: i });
        }
      }
    }
    if (starved) line.push({ cls: '', text: U.plural(starved, 'square') + ' cut off from home are wasting away.' });
    s.supply = computeSupply(s);

    // --- 5. Cinder Pressure ----------------------------------------------
    // Stillness gets a warning, then capped fortifications decay, then a
    // temporary central crossing opens. Cinder creates an attacking window;
    // it never assigns ownership or directly cuts either side's supply.
    var cutAfter = { 1: cutOffCount(1), 2: cutOffCount(2) };
    var supplyShock = cutAfter[1] > cutBefore[1] || cutAfter[2] > cutBefore[2];
    if (territoryChanged || supplyShock) {
      s.pressure.staleTurns = 0;
      s.pressure.warned = false;
    } else {
      s.pressure.staleTurns++;
      if (s.pressure.staleTurns === 2) {
        s.pressure.warned = true;
        line.push({ cls: 'world', text: 'CINDER PRESSURE: two turns without a territorial change. Overbuilt front lines begin to crack.' });
      }
      if (s.pressure.staleTurns >= 3) {
        var eroded = 0;
        for (var ei = 0; ei < s.tiles.length; ei++) {
          var et = s.tiles[ei];
          if (!et.land || (et.owner !== 1 && et.owner !== 2) || et.str <= 3) continue;
          var enemy = et.owner === 1 ? 2 : 1;
          var ens = neighbors(s, ei);
          if (!ens.some(function (n) { return s.tiles[n].land && s.tiles[n].owner === enemy; })) continue;
          et.str--;
          eroded++;
          fx.push({ kind: 'pressure', at: ei });
        }
        if (eroded) line.push({ cls: 'world', text: 'Cinder Pressure strips one excess strength from ' + U.plural(eroded, 'front-line square') + '.' });
      }
      if (s.pressure.staleTurns >= 4 && s.pressure.bridgeTurns <= 0 &&
          s.turn - s.pressure.lastOpenedTurn >= 4) {
        (s.pressureBridge || []).forEach(function (bi) {
          var bridgeTile = s.tiles[bi];
          bridgeTile.land = true;
          bridgeTile.owner = 0;
          bridgeTile.str = 0;
          bridgeTile.elev = 1;
          bridgeTile.fert = 0;
          bridgeTile.route = 'cross';
          bridgeTile.bridge = 'pressure';
          bridgeTile.temporaryBridge = 1;
          bridgeTile.pressureReserved = 1;
          fx.push({ kind: 'rise', at: bi });
        });
        s.pressure.bridgeTurns = 2;
        s.pressure.lastOpenedTurn = s.turn;
        line.push({ cls: 'world', text: 'CINDER PRESSURE: a central cross-caldera bridge opens for two turns. Cinder creates a window, not a winner.' });
      }
    }
    s.supply = computeSupply(s);

    // --- 6. the Beacon ----------------------------------------------------
    var bt = s.tiles[s.beacon];
    var owner = (bt && bt.land && (bt.owner === 1 || bt.owner === 2)) ? bt.owner : 0;
    var holder = owner && s.supply[s.beacon] === owner ? owner : 0;
    if (holder) {
      s.bp[holder] += 1;
      fx.push({ kind: 'beaconTick', at: s.beacon, side: holder });
      line.push({ cls: 'beacon', text: 'The Beacon burns for the ' + SIDE[holder] + '. (' + s.bp[holder] + '/' + BEACON_TO_WIN + ')' });
    } else if (owner) {
      line.push({ cls: 'beacon', text: 'The Beacon is cut off. It scores for nobody this turn.' });
    }

    // --- 7. modifiers tick down ------------------------------------------
    ['ashfall', 'rockCooled', 'storm'].forEach(function (k) {
      if (s.mods[k] > 0) {
        s.mods[k]--;
        if (s.mods[k] === 0) line.push({ cls: 'world', text: modEnd(k) });
      }
    });

    // --- 8. bookkeeping ---------------------------------------------------
    function settledOrders(list, side) {
      return list.map(function (o) {
        return {
          type: o.type,
          from: o.from,
          to: o.to,
          cost: (o.baseCost || costOf(state, o.type)) + (o.mobilizationCost || 0),
          baseCost: o.baseCost || costOf(state, o.type),
          mobilizationCost: o.mobilizationCost || 0,
          targetElev: state.tiles[o.to] ? state.tiles[o.to].elev : 0,
          targetOwner: state.tiles[o.to] ? state.tiles[o.to].owner : 0
        };
      });
    }
    s.stats.push({
      turn: s.turn,
      raids: raidCounts[1] + raidCounts[2],
      captures: captures[1] + captures[2],
      synergyAttacks: synergyAttacks,
      landA: landCount(s, 1),
      landB: landCount(s, 2),
      incomeA: income(s, 1),
      incomeB: income(s, 2),
      cutOffA: cutOffCount(1),
      cutOffB: cutOffCount(2),
      military: { 1: militaryUsed[1], 2: militaryUsed[2] },
      fieldCommands: { 1: fieldUsed[1], 2: fieldUsed[2] },
      redeploys: { 1: redeploys[1], 2: redeploys[2] },
      mobilization: { 1: mobilizationSpent[1], 2: mobilizationSpent[2] },
      support: { 1: supportBySide[1], 2: supportBySide[2] },
      turnIncome: { 1: turnIncome[1], 2: turnIncome[2] },
      budget: { 1: budget[1], 2: budget[2] },
      reserveBefore: reserveBefore,
      reserveAfter: { 1: s.reserve[1], 2: s.reserve[2] },
      strategy: U.deepClone(s.strategy),
      pressure: {
        staleTurns: s.pressure.staleTurns,
        bridgeTurns: s.pressure.bridgeTurns
      },
      beacon: holder,
      beaconTile: state.beacon,
      warningRegion: state.pending ? state.pending.region : null,
      settledOrders: {
        1: settledOrders(accepted[1], 1),
        2: settledOrders(accepted[2], 2)
      },
      spent: { 1: spent[1], 2: spent[2] }
    });

    line.forEach(function (l) { s.feed.push({ turn: s.turn, cls: l.cls || '', text: l.text }); });

    // --- 9. victory -------------------------------------------------------
    // The controller still has to fire any warned event after this turn.
    // Resolve immediate wins here, but leave the turn-limit result until that
    // event has had its promised chance to change the board.
    if (!s.over) s.over = checkVictory(s, false);

    return {
      state: s, fx: fx, spent: spent, budget: budget,
      income: turnIncome, reserveBefore: reserveBefore,
      reserveAfter: { 1: s.reserve[1], 2: s.reserve[2] },
      support: supportBySide
    };
  }

  function checkVictory(s, includeTurnLimit) {
    if (s.bp[1] >= BEACON_TO_WIN) return { winner: 1, why: 'The Ashfarers held the fire long enough to claim the ring.' };
    if (s.bp[2] >= BEACON_TO_WIN) return { winner: 2, why: 'The Saltkin held the fire long enough to claim the ring.' };
    var a = landCount(s, 1), b = landCount(s, 2);
    if (a < 1) return { winner: 2, why: 'The Ashfarers have no ground left.' };
    if (b < 1) return { winner: 1, why: 'The Saltkin have no ground left.' };
    // `turn` is the currently playable turn, not a count of completed turns.
    // Using `turn >= MAX_TURNS` ended the match as soon as turn 25 was shown,
    // leaving only 24 actionable turns. Stats get one entry per resolved turn,
    // so they are the authoritative completion count.
    if (includeTurnLimit !== false && s.stats.length >= MAX_TURNS) {
      if (a === b) return { winner: 0, why: 'Twenty-five turns, and the ring is split exactly. The mountain is unimpressed.' };
      return { winner: a > b ? 1 : 2, why: 'Twenty-five turns. ' + (a > b ? 'The Ashfarers' : 'The Saltkin') + ' hold the most ground: ' + Math.max(a, b) + ' to ' + Math.min(a, b) + '.' };
    }
    return null;
  }

  function relayImpact(state, attacker, at) {
    var tile = state.tiles[at];
    if (!tile || !tile.relay || (attacker !== 1 && attacker !== 2)) return null;
    var defender = tile.owner;
    if (defender !== 1 && defender !== 2 || defender === attacker) {
      return { relay: tile.relay, defender: 0, tiles: 0, fertility: 0, beacon: false };
    }
    var sim = U.deepClone(state);
    sim.supply = computeSupply(sim);
    var before = sim.supply;
    var zone = sim.relays && sim.relays[tile.relay] ? sim.relays[tile.relay] : [at];
    zone.forEach(function (ri) {
      sim.tiles[ri].owner = attacker;
      sim.tiles[ri].str = 1;
    });
    var after = computeSupply(sim);
    var tiles = 0, fertility = 0;
    for (var i = 0; i < sim.tiles.length; i++) {
      var t = sim.tiles[i];
      if (t.land && t.owner === defender && before[i] === defender && after[i] !== defender) {
        tiles++;
        fertility += t.fert;
      }
    }
    var beacon = sim.tiles[sim.beacon].owner === defender && before[sim.beacon] === defender && after[sim.beacon] !== defender;
    return { relay: tile.relay, defender: defender, tiles: tiles, fertility: fertility, beacon: beacon };
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
    FIELD_COMMANDS: FIELD_COMMANDS, EFFORT_HORIZON: EFFORT_HORIZON,
    MOBILIZATION_COST: MOBILIZATION_COST, SUPPORT_COST: SUPPORT_COST,
    RESERVE_CAP: RESERVE_CAP, SIEGE_SUPPORT_BONUS: SIEGE_SUPPORT_BONUS,
    FORTIFY_GAIN: FORTIFY_GAIN,
    MAX_STRENGTH: MAX_STRENGTH, SYNERGY_BONUS: SYNERGY_BONUS,
    newGame: newGame, neighbors: neighbors, ownedTiles: ownedTiles, landCount: landCount,
    laneOf: laneOf, orderLane: orderLane, commandPreview: commandPreview,
    supportType: supportType, planCost: planCost,
    computeSupply: computeSupply, income: income, availableBudget: availableBudget, resolveTurn: resolveTurn,
    canExpand: canExpand, canFortify: canFortify, canRaid: canRaid, raidSources: raidSources,
    attackValue: attackValue, coordinatedAttackValue: coordinatedAttackValue,
    defenceValue: defenceValue, stormSwing: stormSwing,
    costOf: costOf, raidCost: raidCost, isMilitary: isMilitary, isFieldAction: isFieldAction,
    relayImpact: relayImpact, coord: coord, checkVictory: checkVictory
  };
})();
