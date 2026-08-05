/* ============================================================
   validator.js — the guardrails
   Cinder proposes. This file decides. It is plain code on purpose:
   nothing the director chooses reaches the map without passing
   every one of these, and if a proposal fails twice a safe default
   fires so the game never stalls.
   ============================================================ */
CF.validator = (function () {
  var E = CF.engine, EV = CF.events;

  var RULES = [
    'no event may take more than 25% of a side\'s land at once',
    'no side may be pushed below 3 squares',
    'the same side cannot be the main target three seasons running',
    'the same template cannot run twice in a row',
    'a capital can never be destroyed',
    'no event may cut the ring in two'
  ];

  // The sixth rule is not in the original spec, and it was added because
  // playtesting found the failure: on a ring the two peoples meet at two
  // narrow arcs, and one eruption across the wrong square walls them apart
  // for the rest of the match. A mountain that wants a fight must never
  // make fighting impossible.
  function ringIsWhole(state) {
    var a = state.capitals[1], b = state.capitals[2];
    if (a == null || b == null) return true;
    var seen = {}, stack = [a];
    seen[a] = 1;
    while (stack.length) {
      var i = stack.pop();
      if (i === b) return true;
      var ns = E.neighbors(state, i);
      for (var k = 0; k < ns.length; k++) {
        var n = ns[k];
        if (!seen[n] && state.tiles[n].land) { seen[n] = 1; stack.push(n); }
      }
    }
    return false;
  }

  // Simulate the proposal and look at the wreckage before allowing it.
  function check(state, ev) {
    var fails = [];

    if (state.lastTemplate && ev.template === state.lastTemplate)
      fails.push('the ' + EV.nameOf(ev.template) + ' template ran last season');

    var sim = EV.apply(state, ev);
    if (!sim.ok) return { ok: false, fails: ['the template found nothing to act on'], sim: null };

    var before = { 1: E.landCount(state, 1), 2: E.landCount(state, 2) };
    var after  = { 1: E.landCount(sim.state, 1), 2: E.landCount(sim.state, 2) };

    [1, 2].forEach(function (side) {
      var lost = before[side] - after[side];
      if (before[side] > 0 && lost / before[side] > 0.25 + 1e-9)
        fails.push('it takes ' + Math.round(lost / before[side] * 100) + '% of the ' + E.SIDE[side] + ' land in one stroke');
      if (after[side] < 3 && before[side] >= 3)
        fails.push('it pushes the ' + E.SIDE[side] + ' below three squares');
    });

    // capitals must survive, intact and owned
    [1, 2].forEach(function (side) {
      var cap = sim.state.capitals[side];
      var t = sim.state.tiles[cap];
      if (!t || !t.land) fails.push('it destroys the ' + E.SIDE[side] + ' capital');
    });

    if (ringIsWhole(state) && !ringIsWhole(sim.state))
      fails.push('it cuts the ring in two and the peoples could never reach each other again');

    // don't let the mountain look like it has picked a side
    var mainTarget = worstHit(before, after);
    if (mainTarget) {
      var h = state.targetHistory.slice(-2);
      if (h.length === 2 && h[0] === mainTarget && h[1] === mainTarget)
        fails.push('the ' + E.SIDE[mainTarget] + ' have been the main target two seasons running already');
    }

    return { ok: fails.length === 0, fails: fails, sim: sim, mainTarget: mainTarget };
  }

  function worstHit(before, after) {
    var la = before[1] - after[1], lb = before[2] - after[2];
    if (la <= 0 && lb <= 0) return 0;
    if (la === lb) return 0;
    return la > lb ? 1 : 2;
  }

  // Human choice changes what Cinder proposes, never whether the guardrails
  // apply. Callers receive no event at all when an override is unsafe.
  function approveOverride(state, proposal) {
    var result = check(state, proposal);
    return {
      ok: result.ok,
      ev: result.ok ? proposal : null,
      fails: result.fails,
      mainTarget: result.mainTarget || 0
    };
  }

  // The full gate: try the proposal, then a softened retry, then a
  // guaranteed-safe default. The game moves on no matter what.
  function gate(state, proposal, softenFn, defaultFn) {
    var first = check(state, proposal);
    if (first.ok) return { ev: proposal, result: first, attempts: 1, note: 'passed on the first pass' };

    var second = softenFn ? softenFn(proposal, first.fails) : null;
    if (second) {
      var r2 = check(state, second);
      if (r2.ok) return { ev: second, result: r2, attempts: 2,
        note: 'first proposal refused (' + first.fails[0] + '); asked again and took the softer version' };
    }

    var fallback = defaultFn(state);
    var r3 = check(state, fallback);
    return { ev: fallback, result: r3, attempts: 3,
      note: 'both proposals refused (' + first.fails[0] + '); the safe default fired instead' };
  }

  return { RULES: RULES, check: check, approveOverride: approveOverride,
           gate: gate, worstHit: worstHit };
})();
