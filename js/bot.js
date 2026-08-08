/* ============================================================
   bot.js — the Saltkin
   Deliberately simple: scored candidate orders and three moods.
   A simple rival makes the demo fast, cheap and repeatable, and
   lets us force a dead-quiet stalemate on command so the mountain
   has something to fix. All of the interesting machinery is in
   the director, which is the part that is actually new.
   ============================================================ */
CF.bot = (function () {
  var U = CF.util, E = CF.engine, EV = CF.events;

  var MOODS = ['aggressive', 'greedy', 'turtle'];

  function laneOf(state, i) {
    return E.laneOf(state, i);
  }

  function chooseEffort(state, side, doctrine) {
    var locked = state.strategy && state.strategy[side];
    if (locked && locked.untilTurn >= state.turn) return locked;

    var requested = doctrine && (doctrine.target_region === 'NORTH' || doctrine.target_region === 'SOUTH')
      ? doctrine.target_region : null;
    var score = { NORTH: 0, SOUTH: 0 };
    var foe = side === 1 ? 2 : 1;
    for (var i = 0; i < state.tiles.length; i++) {
      var t = state.tiles[i];
      if (!t.land) continue;
      var lane = laneOf(state, i);
      if (t.owner === foe) score[lane] += 2 + t.fert + (t.relay ? 6 : 0) + (i === state.beacon ? 8 : 0);
      if (t.owner === side && t.relay) score[lane] += 2;
    }
    if (state.opening && state.turn <= state.opening.untilTurn)
      score[state.opening.route] += 40;
    if (requested) score[requested] += 20;
    var main = score.NORTH === score.SOUTH
      ? (U.hash32(state.seed + side * 7919 + Math.floor((state.turn - 1) / 3) * 104729) < 0.5 ? 'NORTH' : 'SOUTH')
      : (score.NORTH > score.SOUTH ? 'NORTH' : 'SOUTH');
    return {
      main: main,
      secondary: main === 'NORTH' ? 'HOLD SOUTH' : 'HOLD NORTH',
      issuedTurn: state.turn,
      untilTurn: state.turn + 2
    };
  }

  function chooseMood(state, side, forceTurtle) {
    if (forceTurtle) return 'turtle';

    var me = side, foe = side === 1 ? 2 : 1;
    var myLand = E.landCount(state, me), foeLand = E.landCount(state, foe);
    var bt = state.tiles[state.beacon];
    var holdBeacon = bt.owner === me;
    var foeBeacon = bt.owner === foe;

    // room to grow?
    var open = 0, front = 0;
    for (var i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i].owner !== me) continue;
      var ns = E.neighbors(state, i);
      for (var k = 0; k < ns.length; k++) {
        var t = state.tiles[ns[k]];
        if (t.land && t.owner === 0) open++;
        if (t.land && t.owner === foe) front++;
      }
    }

    if (foeBeacon && state.bp[foe] >= 4) return 'aggressive';
    if (holdBeacon && myLand >= foeLand) return 'turtle';
    if (open >= 3 && front <= 1) return 'greedy';
    if (myLand < foeLand - 2) return 'aggressive';
    if (front >= 3 && myLand > foeLand) return 'turtle';
    return open > front ? 'greedy' : 'aggressive';
  }

  var WEIGHTS = {
    //                                         siege: massing on a frontier
    //                                         square to make a raid possible
    aggressive: { expand: 0.8, fortify: 0.5, raid: 1.6, siege: 1.5 },
    greedy:     { expand: 1.7, fortify: 0.6, raid: 0.7, siege: 0.5 },
    turtle:     { expand: 0.5, fortify: 1.8, raid: 0.15, siege: 0.7 }
  };

  // The Ashfarers came first and learned to farm the ash fields. The
  // Saltkin came later, by sea, and took the high ground. Two peoples
  // who want different squares is the whole reason there is a war, and
  // it is also what stops a mirrored ring from playing itself to a draw.
  // Kept close in total value: height is worth more than soil in a fight,
  // so the Saltkin preference is the milder one or they simply win.
  var TASTE = {
    1: { soil: 3.4, height: 0.8 },
    2: { soil: 2.7, height: 1.5 }
  };

  function plan(state, side, forceTurtle, doctrine) {
    var stanceMood = doctrine && doctrine.stance === 'ASSAULT' ? 'aggressive'
      : doctrine && doctrine.stance === 'GROWTH' ? 'greedy'
      : doctrine && doctrine.stance === 'FORTRESS' ? 'turtle' : null;
    var mood = forceTurtle ? 'turtle' : (stanceMood || chooseMood(state, side, false));
    var base = WEIGHTS[mood];
    var w = { expand: base.expand, fortify: base.fortify, raid: base.raid, siege: base.siege };
    if (doctrine) {
      if (doctrine.objective === 'LAND') w.expand *= 1.3;
      if (doctrine.objective === 'SUPPLY') { w.fortify *= 1.2; w.siege *= 1.2; }
      if (doctrine.objective === 'CAPITAL') w.raid *= 1.25;
      if (doctrine.risk === 'LOW') w.raid *= 0.75;
      if (doctrine.risk === 'HIGH') w.raid *= 1.2;
    }
    var taste = TASTE[side] || TASTE[1];
    var foe = side === 1 ? 2 : 1;
    var budget = E.availableBudget(state, side);
    var cands = [];
    var effort = chooseEffort(state, side, doctrine);

    function effortPull(i) {
      return laneOf(state, i) === effort.main ? 12 : -2;
    }

    var bx = state.beacon % state.W, by = (state.beacon / state.W) | 0;
    function beaconPull(i) {
      var x = i % state.W, y = (i / state.W) | 0;
      var value = 9 / (1 + Math.abs(x - bx) + Math.abs(y - by));
      return doctrine && doctrine.objective === 'BEACON' ? value * 1.6 : value;
    }

    function regionPull(i) {
      if (!doctrine || !doctrine.target_region) return 0;
      var region = doctrine.target_region.toLowerCase();
      return EV.inRegion(state, i, region) ? 6 : 0;
    }

    var mine = E.ownedTiles(state, side);
    var seenExpand = {}, seenRaid = {};

    for (var m = 0; m < mine.length; m++) {
      var from = mine[m];
      var ns = E.neighbors(state, from);

      // --- fortify: worth it where the enemy can actually reach ---------
      var threat = 0;
      for (var a = 0; a < ns.length; a++) {
        var nt = state.tiles[ns[a]];
        if (nt.land && nt.owner === foe) threat = Math.max(threat, nt.str + 3);
      }
      var ft = state.tiles[from];
      if (laneOf(state, from) === effort.main &&
          (threat > 0 || from === state.beacon) && E.canFortify(state, side, from) != null) {
        var gap = threat - E.defenceValue(state, from);
        cands.push({
          type: 'fortify', to: from,
          score: (6 + Math.max(0, gap) * 2.2 + (from === state.beacon ? 9 : 0) + ft.fert +
                  regionPull(from) + effortPull(from)) * w.fortify
        });
      }

      for (var k = 0; k < ns.length; k++) {
        var i = ns[k], t = state.tiles[i];
        if (!t.land) continue;

        // --- expand -----------------------------------------------------
        if (laneOf(state, i) === effort.main && t.owner === 0 && !seenExpand[i]) {
          seenExpand[i] = 1;
          cands.push({
            type: 'expand', to: i,
            score: (4 + t.fert * taste.soil + t.elev * taste.height + beaconPull(i) +
                    (i === state.beacon ? 12 : 0) + (t.relay ? 10 : 0) + regionPull(i)) * w.expand
          });
        }

        // --- raid, or the build-up toward one ---------------------------
        if (laneOf(state, i) === effort.main && (t.owner === foe || t.owner === 3)) {
          var def = E.defenceValue(state, i);
          var prize = t.fert * taste.soil * 0.6 + t.elev * taste.height * 0.6
                    + beaconPull(i) + (i === state.beacon ? 16 : 0)
                    + (t.capital ? 30 : 0) + (t.relay ? 24 : 0)
                    - (t.owner === 3 ? 4 : 0);

          if (!seenRaid[i]) {
            seenRaid[i] = 1;
            var sources = E.raidSources(state, side, i);
            var src = sources.length ? sources[0] : null;
            if (src != null) {
              var margin = E.attackValue(state, src, side) - def;
              // never throw squares away on an attack that cannot land
              if (margin > 0) cands.push({
                type: 'raid', from: src, to: i,
                score: (7 + margin * 1.5 + prize + regionPull(i) + effortPull(i)) * w.raid
              });
            }

            var supplied = sources.filter(function (source) { return state.supply[source] === side; });
            if (supplied.length >= 2) {
              var pair = supplied.slice(0, 2);
              var pairMargin = E.coordinatedAttackValue(state, pair, side) - def;
              var canFundSiege = budget >= E.raidCost(state) * 2 + E.MOBILIZATION_COST + E.SUPPORT_COST;
              var fundedMargin = pairMargin + (canFundSiege ? E.SIEGE_SUPPORT_BONUS : 0);
              if (fundedMargin > 0) cands.push({
                type: 'raid_pair', from: pair, to: i,
                score: (15 + fundedMargin * 2 + prize * 1.35 + regionPull(i) + effortPull(i) * 1.5) * w.raid
              });
            }
          }

          // If the square cannot be taken today, massing on the square we
          // would attack from makes it takeable in a turn or two. Without
          // this the rival stares at a wall forever and the border never
          // moves again — a stalemate nobody chose and nobody can end.
          var deficit = def - (ft.str + 3 + E.stormSwing(state, side));
          if (deficit >= 0 && deficit < 7 && E.canFortify(state, side, from) != null) {
            cands.push({ type: 'fortify', to: from, score: (12 + prize - deficit * 1.5 + regionPull(from)) * w.siege });
          }
        }
      }
    }

    // A concentrated pair of Expand orders can move two squares deep. This is
    // the opening-tempo reward for committing both commands to one route.
    cands.filter(function (o) { return o.type === 'expand'; }).forEach(function (first) {
      E.neighbors(state, first.to).forEach(function (to) {
        var t = state.tiles[to];
        if (!t.land || t.owner !== 0 || laneOf(state, to) !== effort.main) return;
        if (E.canExpand(state, side, to) != null) return; // already a direct option
        if (E.canExpand(state, side, to, [{ type: 'expand', to: first.to }]) !== first.to) return;
        var value = 6 + t.fert * taste.soil + t.elev * taste.height + beaconPull(to) +
          (to === state.beacon ? 14 : 0) + (t.relay ? 12 : 0) + regionPull(to);
        cands.push({
          type: 'expand_chain', first: first.to, to: to,
          score: first.score + value * w.expand + 14
        });
      });
    });

    cands.sort(function (p, q) { return q.score - p.score; });

    // Expand, Raid, and Fortify all draw from the same two field commands.
    // Paired raids and chained expansion deliberately consume both.
    var orders = [], spent = 0, field = 0, fortified = {}, expandedTo = {}, raidSourcesUsed = {};
    for (var c = 0; c < cands.length; c++) {
      var o = cands[c];
      var trial, trialCost;
      if (o.type === 'raid_pair') {
        if (field > 0) continue;
        trial = orders.concat([
          { type: 'raid', from: o.from[0], to: o.to },
          { type: 'raid', from: o.from[1], to: o.to }
        ]);
        trialCost = E.planCost(state, side, trial, false);
        if (!trialCost.ok || trialCost.total > budget) continue;
        orders = trial;
        field = trialCost.commands;
        spent = trialCost.total;
        raidSourcesUsed[o.to] = o.from.slice();
        continue;
      }
      if (o.type === 'expand_chain') {
        if (field > 0 || expandedTo[o.first] || expandedTo[o.to]) continue;
        trial = orders.concat([
          { type: 'expand', to: o.first },
          { type: 'expand', from: o.first, to: o.to }
        ]);
        trialCost = E.planCost(state, side, trial, false);
        if (!trialCost.ok || trialCost.total > budget) continue;
        orders = trial;
        field = trialCost.commands;
        expandedTo[o.first] = expandedTo[o.to] = true;
        spent = trialCost.total;
        continue;
      }
      if (o.type === 'fortify') {
        if (fortified[o.to]) continue;
      }
      if (o.type === 'raid') {
        var used = raidSourcesUsed[o.to] || [];
        if (used.indexOf(o.from) >= 0) continue;
      }
      if (o.type === 'expand' && expandedTo[o.to]) continue;
      trial = orders.concat([{ type: o.type, from: o.from, to: o.to }]);
      trialCost = E.planCost(state, side, trial, false);
      if (!trialCost.ok || trialCost.total > budget) continue;
      orders = trial;
      field = trialCost.commands;
      if (o.type === 'fortify') fortified[o.to] = true;
      if (o.type === 'raid') (raidSourcesUsed[o.to] || (raidSourcesUsed[o.to] = [])).push(o.from);
      if (o.type === 'expand') expandedTo[o.to] = true;
      spent = trialCost.total;
      if (field >= E.FIELD_COMMANDS) break;
    }

    // A turtle may spend a remaining command, but never twice on one square,
    // never while cut off, and never above the global strength cap.
    if (mood === 'turtle' && field < E.FIELD_COMMANDS && budget - spent >= E.COST.fortify) {
      var stack = mine.slice().sort(function (p, q) {
        return (state.tiles[q].fert + state.tiles[q].elev) - (state.tiles[p].fert + state.tiles[p].elev);
      });
      for (var si = 0; si < stack.length && field < E.FIELD_COMMANDS && budget - spent >= E.COST.fortify; si++) {
        var to = stack[si];
        if (laneOf(state, to) !== effort.main || fortified[to] || E.canFortify(state, side, to) == null) continue;
        trial = orders.concat([{ type: 'fortify', to: to }]);
        trialCost = E.planCost(state, side, trial, false);
        if (!trialCost.ok || trialCost.total > budget) continue;
        orders = trial;
        fortified[to] = true;
        field = trialCost.commands;
        spent = trialCost.total;
      }
    }

    var support = E.supportType(state, side, orders);
    var supportedCost = E.planCost(state, side, orders, !!support);
    if (support && supportedCost.total <= budget) {
      orders.support = true;
      spent = supportedCost.total;
    }

    orders.mainEffort = effort.main;
    orders.effortUntil = effort.untilTurn;
    return {
      orders: orders, mood: mood, budget: budget, spent: spent,
      fieldCommands: field,
      support: orders.support ? support : null,
      military: orders.filter(function (o) { return E.isMilitary(o.type); }).length,
      effort: effort, doctrine: doctrine || null
    };
  }

  return { MOODS: MOODS, plan: plan, chooseMood: chooseMood, chooseEffort: chooseEffort, laneOf: laneOf };
})();
