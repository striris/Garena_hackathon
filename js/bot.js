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
    var budget = E.income(state, side);
    var cands = [];

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
      if (threat > 0 || from === state.beacon) {
        var gap = threat - E.defenceValue(state, from);
        cands.push({
          type: 'fortify', to: from,
          score: (6 + Math.max(0, gap) * 2.2 + (from === state.beacon ? 9 : 0) + ft.fert + regionPull(from)) * w.fortify
        });
      }

      for (var k = 0; k < ns.length; k++) {
        var i = ns[k], t = state.tiles[i];
        if (!t.land) continue;

        // --- expand -----------------------------------------------------
        if (t.owner === 0 && !seenExpand[i]) {
          seenExpand[i] = 1;
          cands.push({
            type: 'expand', to: i,
            score: (4 + t.fert * taste.soil + t.elev * taste.height + beaconPull(i) +
                    (i === state.beacon ? 12 : 0) + regionPull(i)) * w.expand
          });
        }

        // --- raid, or the build-up toward one ---------------------------
        if (t.owner === foe || t.owner === 3) {
          var def = E.defenceValue(state, i);
          var prize = t.fert * taste.soil * 0.6 + t.elev * taste.height * 0.6
                    + beaconPull(i) + (i === state.beacon ? 16 : 0)
                    + (t.capital ? 30 : 0) - (t.owner === 3 ? 4 : 0);

          if (!seenRaid[i]) {
            seenRaid[i] = 1;
            var src = E.canRaid(state, side, i);
            if (src != null) {
              var margin = E.attackValue(state, src, side) - def;
              // never throw squares away on an attack that cannot land
              if (margin > 0) cands.push({ type: 'raid', to: i, score: (7 + margin * 1.5 + prize + regionPull(i)) * w.raid });
            }
          }

          // If the square cannot be taken today, massing on the square we
          // would attack from makes it takeable in a turn or two. Without
          // this the rival stares at a wall forever and the border never
          // moves again — a stalemate nobody chose and nobody can end.
          var deficit = def - (ft.str + 3 + E.stormSwing(state, side));
          if (deficit >= 0 && deficit < 7) {
            cands.push({ type: 'fortify', to: from, score: (12 + prize - deficit * 1.5 + regionPull(from)) * w.siege });
          }
        }
      }
    }

    cands.sort(function (p, q) { return q.score - p.score; });

    // greedy spend, with a cap on stacking the same square twice
    var orders = [], spent = 0, fortCount = {};
    for (var c = 0; c < cands.length; c++) {
      var o = cands[c];
      var cost = E.costOf(state, o.type);
      if (spent + cost > budget) continue;
      if (o.type === 'fortify') {
        fortCount[o.to] = (fortCount[o.to] || 0) + 1;
        if (fortCount[o.to] > 2) continue;
      }
      orders.push({ type: o.type, to: o.to });
      spent += cost;
    }

    // A turtle with money left over digs in rather than sitting on it, but
    // the same two-per-square cap applies. Without it a turtle stacks one
    // hill out of reach forever and the match never restarts.
    if (mood === 'turtle' && budget - spent >= 1) {
      var stack = mine.slice().sort(function (p, q) {
        return (state.tiles[q].fert + state.tiles[q].elev) - (state.tiles[p].fert + state.tiles[p].elev);
      });
      for (var si = 0; si < stack.length && budget - spent >= 1; si++) {
        var to = stack[si];
        while (budget - spent >= 1 && (fortCount[to] || 0) < 2) {
          orders.push({ type: 'fortify', to: to });
          fortCount[to] = (fortCount[to] || 0) + 1;
          spent += 1;
        }
      }
    }

    return { orders: orders, mood: mood, budget: budget, spent: spent, doctrine: doctrine || null };
  }

  return { MOODS: MOODS, plan: plan, chooseMood: chooseMood };
})();
