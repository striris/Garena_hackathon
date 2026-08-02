/* ============================================================
   director.js — Cinder
   The mountain does not care who wins. What it cannot stand is
   stillness. Every three turns it reads the match, picks one
   template from the library, warns the players, says what they
   did to deserve it, and predicts what will happen next. The
   season after, that prediction gets marked right or wrong and
   the answer feeds back in.

   This build runs the director as a scored heuristic rather than
   a language model — the same interface, the same five outputs,
   no network call. See README for the swap point.
   ============================================================ */
CF.director = (function () {
  var U = CF.util, E = CF.engine, EV = CF.events;

  // ---------------------------------------------------------------- read
  // Not raw game data. A short plain report, the way we would brief
  // a person who had just walked in.
  function read(state) {
    var r = {};
    r.turn = state.turn;
    r.season = state.season + 1;
    r.landA = E.landCount(state, 1);
    r.landB = E.landCount(state, 2);
    r.leader = r.landA === r.landB ? 0 : (r.landA > r.landB ? 1 : 2);
    r.landGap = Math.abs(r.landA - r.landB);
    r.incomeA = E.income(state, 1);
    r.incomeB = E.income(state, 2);
    r.incomeGap = Math.abs(r.incomeA - r.incomeB);

    var st = state.stats;
    var win = st.slice(-4);
    r.raidsRecent = win.reduce(function (a, s) { return a + s.raids; }, 0);
    r.raidsPerTurn = win.length ? r.raidsRecent / win.length : 0;

    r.quiet = 0;
    for (var i = st.length - 1; i >= 0; i--) { if (st[i].raids > 0) break; r.quiet++; }

    r.beaconOwner = state.tiles[state.beacon].owner;
    r.beaconStill = 0;
    for (var j = st.length - 1; j >= 0; j--) {
      if (j < st.length - 1 && st[j].beacon !== st[st.length - 1].beacon) break;
      r.beaconStill++;
    }

    // stacking: are they piling strength onto high ground instead of moving?
    var hg = 0, hgStr = 0, lowOwned = { 1: 0, 2: 0 }, empty = 0, frontier = 0;
    for (var k = 0; k < state.tiles.length; k++) {
      var t = state.tiles[k];
      if (!t.land) continue;
      if (t.owner === 0) { empty++; continue; }
      if (t.owner === 1 || t.owner === 2) {
        if (t.elev >= 2) { hg++; hgStr += t.str; }
        if (t.elev <= 1) lowOwned[t.owner]++;
        var ns = E.neighbors(state, k);
        for (var n = 0; n < ns.length; n++) {
          var o = state.tiles[ns[n]];
          if (o.land && (o.owner === 1 || o.owner === 2) && o.owner !== t.owner) frontier++;
        }
      }
    }
    r.highGround = hg;
    r.stacking = hg ? hgStr / hg : 0;
    r.lowOwned = lowOwned;
    r.emptyLand = empty;
    r.frontier = frontier / 2;

    // cut-off squares are a sign that supply lines are already fragile
    var cut = 0;
    for (var m = 0; m < state.tiles.length; m++) {
      var tt = state.tiles[m];
      if (tt.land && (tt.owner === 1 || tt.owner === 2) && state.supply[m] !== tt.owner) cut++;
    }
    r.cutOff = cut;

    return r;
  }

  // a plain report, in words, exactly as it goes into the console
  function brief(state, r) {
    var lines = [];
    lines.push('Season ' + r.season + ', turn ' + r.turn + '.');
    lines.push('The Ashfarers hold ' + r.landA + ' squares, the Saltkin ' + r.landB + '.');
    lines.push(r.quiet >= 2
      ? 'Nobody has attacked for ' + U.plural(r.quiet, 'turn') + '.'
      : 'Fighting is running at about ' + r.raidsPerTurn.toFixed(1) + ' raids a turn.');
    if (r.stacking >= 4) lines.push('Both sides are stacking defence on high ground (average ' + r.stacking.toFixed(1) + ').');
    lines.push(r.beaconOwner
      ? 'The Beacon is held by the ' + E.SIDE[r.beaconOwner] + ' and has not changed hands in ' + U.plural(r.beaconStill, 'turn') + '.'
      : 'The Beacon stands in open ground, unclaimed.');
    if (r.cutOff) lines.push(U.plural(r.cutOff, 'square') + ' are cut off from a capital.');
    lines.push(r.emptyLand + ' squares of land belong to nobody.');

    var last = state.chronicle[state.chronicle.length - 1];
    if (last) {
      lines.push('Last season we caused ' + EV.nameOf(last.template).toLowerCase() +
        ' and the fighting ' + (last.predictionResult === 'hit' ? 'moved the way we said'
        : last.predictionResult === 'miss' ? 'did not do what we said'
        : 'has not been measured yet') + '.');
    }
    return lines.join('\n');
  }

  // ------------------------------------------------------------- scoring
  // Each template argues for itself out of the situation. The winner is
  // the one with the strongest case, after memory and the guardrails.
  function candidates(state, r) {
    var out = [];
    function add(template, score, why, region, intensity, prediction) {
      out.push({ template: template, score: score, why: why, region: region,
                 intensity: U.clamp(intensity, 1, 3), prediction: prediction });
    }

    var busyRegion = hottestRegion(state);
    var quietRegion = coldestRegion(state);
    var leaderRegion = sideRegion(state, r.leader || 1);

    // Stillness is the mountain's enemy, so quiet turns are the loudest
    // signal in the report — but capped, or nothing else ever gets a turn.
    var still = Math.min(r.quiet, 6);

    add('rock_cools',
      14 + still * 7 + Math.max(0, r.stacking - 3) * 5,
      'nobody has fought for ' + U.plural(r.quiet, 'turn') + ' and the defence stacked on high ground is what is holding the line still',
      null, r.quiet >= 5 ? 3 : 2,
      { metric: 'raids', dir: 'up', mag: 0.6, text: 'Raids should rise by about half once height stops paying.' });

    add('beacon_move',
      14 + Math.min(r.beaconStill, 8) * 3.5 + (r.beaconOwner ? 9 : 0) + still * 2.5,
      'the fire has sat in the same place for ' + U.plural(r.beaconStill, 'turn') +
      (r.beaconOwner ? ' under one people' : ''),
      null, r.beaconStill >= 8 ? 3 : 2,
      { metric: 'raids', dir: 'up', mag: 0.5, text: 'Moving the fire into open ground should pull both sides toward it.' });

    // --- a runaway leader needs slowing, not punishing --------------------
    add('ashfall',
      10 + Math.max(0, r.raidsPerTurn - 1.2) * 13 + Math.max(0, r.landGap - 3) * 3,
      'raids are running at ' + r.raidsPerTurn.toFixed(1) + ' a turn and one side is pulling away',
      null, r.landGap >= 6 ? 3 : 2,
      { metric: 'raids', dir: 'down', mag: 0.4, text: 'Doubling the price of a raid should cut fighting by roughly a third.' });

    add('storm',
      11 + Math.max(0, r.landGap - 2) * 5 + Math.max(0, r.incomeGap - 3) * 2,
      'the gap is ' + r.landGap + ' squares and ' + r.incomeGap + ' income; the losing side needs the weather',
      null, r.landGap >= 7 ? 3 : 2,
      { metric: 'raids', dir: 'up', mag: 0.3, text: 'The trailing side should start attacking again.' });

    // --- reshape the board -----------------------------------------------
    add('eruption',
      16 + Math.max(0, 5 - r.frontier) * 4 + (r.quiet >= 3 ? 10 : 0) + r.stacking * 1.2,
      'the two peoples only touch in ' + Math.round(r.frontier) + ' places; the map needs a new prize in the middle of somebody\'s comfort',
      busyRegion, r.quiet >= 4 ? 3 : 2,
      { metric: 'raids', dir: 'up', mag: 0.8, text: 'The wreckage becomes the richest soil on the map. Everyone will want it.' });

    add('earthquake',
      13 + r.landGap * 2 + (r.landA + r.landB > 26 ? 8 : 0) + (r.cutOff ? 4 : 0),
      'territories are long and thin, and a seam through ' + (r.leader ? E.SIDE[r.leader] + ' ground' : 'the middle') + ' would cut supply rather than just land',
      leaderRegion, 2,
      { metric: 'raids', dir: 'up', mag: 0.4, text: 'Cut supply lines force somebody to move.' });

    add('new_island',
      15 + Math.max(0, 10 - r.emptyLand) * 2.6 + (r.quiet >= 2 ? 7 : 0),
      'only ' + r.emptyLand + ' squares are unclaimed; without free land there is nothing to race for',
      'centre', 2,
      { metric: 'raids', dir: 'up', mag: 0.4, text: 'Fresh land between them should restart the race.' });

    add('tide',
      9 + (r.lowOwned[1] + r.lowOwned[2]) * 1.4,
      (r.lowOwned[1] + r.lowOwned[2]) + ' held squares sit on low ground and the same rule will hit both peoples',
      busyRegion, 2,
      { metric: 'raids', dir: 'up', mag: 0.3, text: 'Losing low ground should push both sides upward into each other.' });

    add('bloom',
      9 + (r.emptyLand > 6 ? 6 : 0) + (r.quiet >= 3 ? 5 : 0),
      'there is a quiet corner nobody has any reason to walk into',
      quietRegion, 2,
      { metric: 'raids', dir: 'up', mag: 0.3, text: 'A rich quiet corner should draw somebody out of position.' });

    add('settlers',
      12 + (r.emptyLand > 5 ? 7 : 0) + (r.frontier < 3 ? 6 : 0),
      'there is enough open ground for a third people to land on, and neither side would tolerate it',
      'centre', 2,
      { metric: 'raids', dir: 'up', mag: 0.5, text: 'Someone will move on the newcomers within two turns.' });

    return out;
  }

  // --- memory ------------------------------------------------------------
  // A rule engine fires the same drought the tenth time conditions match.
  // Cinder can see it tried that twice already and that it worked less
  // each time.
  function applyMemory(state, cands) {
    cands.forEach(function (c) {
      var m = state.memory[c.template];
      c.memoryNote = '';
      if (!m) return;
      var repeat = m.uses * 7;
      var missPenalty = m.misses * 9;
      var hitBonus = m.hits * 4;
      c.score -= repeat + missPenalty;
      c.score += hitBonus;
      var bits = [];
      if (m.uses) bits.push('used ' + m.uses + 'x');
      if (m.hits) bits.push(m.hits + ' predictions right');
      if (m.misses) bits.push(m.misses + ' wrong');
      c.memoryNote = bits.join(', ');
    });
    return cands;
  }

  // ------------------------------------------------------------- regions
  function densityByRegion(state, filter) {
    var d = {};
    EV.REGIONS.forEach(function (rg) { d[rg] = 0; });
    for (var i = 0; i < state.tiles.length; i++) {
      if (!filter(state.tiles[i], i)) continue;
      EV.REGIONS.forEach(function (rg) { if (EV.inRegion(state, i, rg)) d[rg]++; });
    }
    return d;
  }

  function hottestRegion(state) {
    // where the two peoples actually touch
    var d = densityByRegion(state, function (t, i) {
      if (!t.land || !t.owner || t.owner === 3) return false;
      var ns = E.neighbors(state, i);
      for (var k = 0; k < ns.length; k++) {
        var o = state.tiles[ns[k]];
        if (o.land && o.owner && o.owner !== t.owner) return true;
      }
      return false;
    });
    return argmax(d, state);
  }

  function coldestRegion(state) {
    var d = densityByRegion(state, function (t) { return t.land && t.owner === 0; });
    return argmax(d, state);
  }

  function sideRegion(state, side) {
    var d = densityByRegion(state, function (t) { return t.land && t.owner === side; });
    return argmax(d, state);
  }

  // Ties matter here. Early on, nothing is contested and every region scores
  // zero — and a fixed fallback meant season one always struck the same place
  // and maimed the same people every single match.
  function argmax(d, state) {
    var best = null, bv = -1, ties = [];
    Object.keys(d).forEach(function (k) {
      if (d[k] > bv) { bv = d[k]; best = k; ties = [k]; }
      else if (d[k] === bv) ties.push(k);
    });
    if (ties.length > 1 && state) {
      var rand = U.rng({ seed: state.rngSeed + state.turn * 7919 });
      return U.pick(rand, ties);
    }
    return best || 'centre';
  }

  // ------------------------------------------------------------ decision
  function decide(state) {
    var r = read(state);
    var report = brief(state, r);

    var cands = applyMemory(state, candidates(state, r));
    cands.sort(function (a, b) { return b.score - a.score; });

    // Cinder is told the guardrails, so it does not waste a proposal on the
    // one rule it can check for itself: never the same template twice.
    var ranked = cands.filter(function (c) { return c.template !== state.lastTemplate; });
    if (!ranked.length) ranked = cands;

    var top = ranked[0];
    var proposal = {
      template: top.template,
      intensity: top.intensity,
      region: top.region || U.pick(U.rng({ seed: state.rngSeed + state.turn }), EV.REGIONS),
      prediction: top.prediction
    };

    // one retry, exactly as the spec allows: a gentler version of the same
    // idea if the objection was about damage, otherwise the runner-up
    var soften = function (p, fails) {
      var tooMuch = fails.some(function (f) { return /takes \d+%|below three/.test(f); });
      if (tooMuch && p.intensity > 1)
        return { template: p.template, intensity: p.intensity - 1, region: p.region, prediction: p.prediction };
      for (var k = 0; k < ranked.length; k++) {
        var c = ranked[k];
        if (c.template === p.template) continue;
        return { template: c.template, intensity: Math.min(c.intensity, 2),
                 region: c.region || p.region, prediction: c.prediction };
      }
      return null;
    };

    var gated = CF.validator.gate(state, proposal, soften, safeDefault);
    var ev = gated.ev;

    // if the gate swapped the template, carry the right prediction with it
    if (ev.template !== proposal.template) {
      var repl = cands.filter(function (c) { return c.template === ev.template; })[0];
      ev.prediction = (repl && repl.prediction) || { metric: 'raids', dir: 'up', mag: 0.2, text: 'A small nudge. We will see.' };
    }

    ev.season = r.season;
    ev.fireTurn = state.turn + 1;
    ev.warning = EV.warningFor(ev);
    ev.reasoning = writeReasoning(state, r, cands, gated, ev);
    ev.report = report;
    ev.mainTarget = gated.result.mainTarget || 0;
    ev.shortlist = cands.slice(0, 4).map(function (c) {
      return { t: c.template, s: Math.round(c.score), why: c.why, mem: c.memoryNote };
    });

    return ev;
  }

  function writeReasoning(state, r, cands, gated, ev) {
    var L = [];
    L.push('Chose ' + EV.nameOf(ev.template) + ' at intensity ' + ev.intensity +
           (ev.region ? ', aimed at ' + EV.regionName(ev.region) : '') + '.');
    L.push('');
    L.push('Why: ' + (cands.filter(function (c) { return c.template === ev.template; })[0] || cands[0]).why + '.');
    var mem = state.memory[ev.template];
    if (mem) L.push('Memory: this template has run ' + U.plural(mem.uses, 'time') + ' already, ' +
                    mem.hits + ' predictions right and ' + mem.misses + ' wrong. It still scored highest.');
    L.push('');
    L.push('Runners-up:');
    cands.slice(1, 4).forEach(function (c) {
      L.push('  · ' + EV.nameOf(c.template) + ' (' + Math.round(c.score) + ') — ' + c.why +
             (c.memoryNote ? ' [' + c.memoryNote + ']' : ''));
    });
    L.push('');
    L.push('Guardrails: ' + gated.note + '.');
    if (gated.result.fails && gated.result.fails.length)
      L.push('Remaining objections: ' + gated.result.fails.join('; ') + '.');
    L.push('');
    L.push('Prediction: ' + ev.prediction.text);
    return L.join('\n');
  }

  // a default that can never break a guardrail
  function safeDefault(state) {
    var t = state.lastTemplate === 'bloom' ? 'beacon_move' : 'bloom';
    return { template: t, intensity: 1, region: coldestRegion(state),
             prediction: { metric: 'raids', dir: 'up', mag: 0.2,
                           text: 'A safe default. We expect only a small change.' } };
  }

  // ---------------------------------------------------------- prediction
  // The best idea in the project: we say what should happen, then we
  // check, then the answer goes back into memory. A rule engine never
  // finds out it was wrong.
  function scorePrediction(state, entry) {
    if (!entry || entry.predictionResult !== 'pending') return entry;
    var st = state.stats;
    var fire = entry.fireTurn;
    // fixed windows either side of the event, or a long quiet tail would
    // wash every prediction out to nothing
    var before = st.filter(function (s) { return s.turn < fire && s.turn >= fire - 3; });
    var after = st.filter(function (s) { return s.turn >= fire && s.turn < fire + 3; });
    if (after.length < 2) return entry;

    var avg = function (a) { return a.length ? a.reduce(function (x, s) { return x + s.raids; }, 0) / a.length : 0; };
    var b = avg(before), a = avg(after);
    var change = b === 0 ? (a > 0 ? 1 : 0) : (a - b) / b;

    var p = entry.prediction;
    var wanted = p.dir === 'up' ? 1 : -1;
    var moved = change * wanted;
    var hit = moved >= p.mag * 0.5;

    entry.predictionResult = hit ? 'hit' : 'miss';
    entry.measured = 'raids went from ' + b.toFixed(1) + ' to ' + a.toFixed(1) + ' a turn (' +
                     (change >= 0 ? '+' : '') + Math.round(change * 100) + '%)';

    var m = state.memory[entry.template] || (state.memory[entry.template] = { uses: 0, hits: 0, misses: 0 });
    if (hit) m.hits++; else m.misses++;
    return entry;
  }

  function noteUse(state, template) {
    var m = state.memory[template] || (state.memory[template] = { uses: 0, hits: 0, misses: 0 });
    m.uses++;
  }

  return { read: read, brief: brief, decide: decide, scorePrediction: scorePrediction,
           noteUse: noteUse, safeDefault: safeDefault };
})();
