/* ============================================================
   profile.js — privacy-preserving player adaptation
   Derives aggregate behaviour only from resolved public history. The current
   order queue never enters this module or an AI request.
   ============================================================ */
CF.profile = (function () {
  var E = CF.engine, EV = CF.events;
  var STORAGE_KEY = 'cinderfall.player-memory.v2';
  var VERSION = 2;

  function emptyMemory() { return { version: VERSION, matches: [] }; }

  function load() {
    if (typeof localStorage === 'undefined') return emptyMemory();
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.matches)) return emptyMemory();
      parsed.matches = parsed.matches.slice(-5);
      return parsed;
    } catch (_) { return emptyMemory(); }
  }

  function save(memory) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memory)); } catch (_) { /* storage is optional */ }
  }

  function clear() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* storage is optional */ }
  }

  function ratio(n, d) { return d ? +(n / d).toFixed(3) : 0; }
  function tactic(actions) {
    var keys = ['raid', 'expand', 'fortify'];
    keys.sort(function (a, b) { return actions[b] - actions[a] || a.localeCompare(b); });
    return actions[keys[0]] ? keys[0].toUpperCase() : 'NONE';
  }

  function build(state, memory) {
    memory = memory || load();
    var totalTargets = 0, nearBeacon = 0, north = 0, south = 0;
    var fortifyOrders = 0, highFortifyOrders = 0;
    var cutOffTileTurns = 0, ownedTileTurns = 0;
    var warning = { avoid: 0, fortify: 0, press: 0 };
    var actions = { raid: 0, expand: 0, fortify: 0 };
    (state.stats || []).forEach(function (stat) {
      cutOffTileTurns += stat.cutOffA || 0;
      ownedTileTurns += stat.landA || 0;
      var list = stat.settledOrders && stat.settledOrders[1] ? stat.settledOrders[1] : [];
      list.forEach(function (o) {
        totalTargets++;
        if (actions[o.type] != null) actions[o.type]++;
        var x = o.to % state.W, y = (o.to / state.W) | 0;
        var historicBeacon = stat.beaconTile == null ? state.beacon : stat.beaconTile;
        var historicBx = historicBeacon % state.W, historicBy = (historicBeacon / state.W) | 0;
        if (Math.abs(x - historicBx) + Math.abs(y - historicBy) <= 2) nearBeacon++;
        if (y < state.H / 2) north++; else south++;
        if (o.type === 'fortify') {
          fortifyOrders++;
          if (o.targetElev >= 1) highFortifyOrders++;
        }
        if (stat.warningRegion) {
          if (!EV.inRegion(state, o.to, stat.warningRegion)) warning.avoid++;
          else if (o.type === 'fortify') warning.fortify++;
          else warning.press++;
        }
      });
    });

    var arc = north === south ? 'MIXED' : north > south ? 'NORTH' : 'SOUTH';
    var warningResponse = 'UNKNOWN', best = 0;
    Object.keys(warning).forEach(function (key) {
      if (warning[key] > best) { best = warning[key]; warningResponse = key.toUpperCase(); }
    });
    var previous = memory.matches.length ? memory.matches[memory.matches.length - 1] : null;

    return {
      features: {
        beacon_chase: ratio(nearBeacon, totalTargets),
        high_ground_turtle: ratio(highFortifyOrders, fortifyOrders),
        preferred_arc: arc,
        supply_neglect: ratio(cutOffTileTurns, ownedTileTurns),
        warning_response: warningResponse,
        last_match_tactic: previous ? previous.tactic : 'NONE'
      },
      evidence: {
        resolved_turns: state.stats.length,
        beacon_near_orders: nearBeacon,
        total_targeted_orders: totalTargets,
        north_order_share: ratio(north, totalTargets),
        south_order_share: ratio(south, totalTargets),
        high_ground_fortify_orders: highFortifyOrders,
        total_fortify_orders: fortifyOrders,
        cut_off_tile_turns: cutOffTileTurns,
        owned_tile_turns: ownedTileTurns,
        warning_avoid_orders: warning.avoid,
        warning_fortify_orders: warning.fortify,
        warning_press_orders: warning.press,
        previous_match_tactic: previous ? previous.tactic : 'NONE'
      },
      currentTactic: tactic(actions)
    };
  }

  function oppositeFront(front) { return front === 'NORTH' ? 'SOUTH' : 'NORTH'; }

  // Three trusted cards expose a real strategic trade-off while keeping the
  // model away from tiles, token spending and legality. Their IDs are the only
  // values the LLM may return.
  function strategyCandidates(state, profile) {
    profile = profile || build(state).features;
    var observed = profile.preferred_arc;
    if (observed !== 'NORTH' && observed !== 'SOUTH') observed = state.turn % 2 ? 'NORTH' : 'SOUTH';
    var other = oppositeFront(observed);

    var pressure = { NORTH: 0, SOUTH: 0 };
    for (var i = 0; i < state.tiles.length; i++) {
      var t = state.tiles[i];
      if (!t.land || (t.owner !== 1 && t.owner !== 2)) continue;
      var front = ((i / state.W) | 0) < state.H / 2 ? 'NORTH' : 'SOUTH';
      pressure[front] += t.owner === 1 ? 1 : -1;
    }
    var threatened = pressure.NORTH === pressure.SOUTH ? other
      : pressure.NORTH > pressure.SOUTH ? 'NORTH' : 'SOUTH';

    return [
      { id: 'S1', intent: 'RAID', region: observed },
      { id: 'S2', intent: 'EXPAND', region: other },
      { id: 'S3', intent: state.tiles[state.beacon].owner === 2 ? 'DEFEND' : 'BEACON', region: 'BEACON' }
    ];
  }

  function resolveStrategyCard(payload, decision) {
    if (!payload || !decision || !Array.isArray(payload.candidates)) return null;
    var card = payload.candidates.filter(function (c) { return c.id === decision.selected_candidate; })[0];
    if (!card) return null;
    return {
      id: card.id,
      intent: card.intent,
      region: card.region,
      evidence_used: (decision.evidence_used || []).slice(),
      explanation: decision.explanation || ''
    };
  }

  function fertileSiteControl(state) {
    var out = {
      ashfarers: { owned: 0, supplied: 0 },
      saltkin: { owned: 0, supplied: 0 },
      open: 0
    };
    state.tiles.forEach(function (t, i) {
      if (!t.land || !t.fertileSite) return;
      if (t.owner === 1) {
        out.ashfarers.owned++;
        if (state.supply[i] === 1) out.ashfarers.supplied++;
      } else if (t.owner === 2) {
        out.saltkin.owned++;
        if (state.supply[i] === 2) out.saltkin.supplied++;
      } else out.open++;
    });
    return out;
  }

  function requestPayload(state, matchId) {
    var memory = load();
    var profile = build(state, memory);
    var cards = strategyCandidates(state, profile.features);
    var relayControl = {};
    Object.keys(state.relays || {}).forEach(function (name) {
      var counts = { ashfarers: 0, saltkin: 0, open: 0 };
      state.relays[name].forEach(function (i) {
        var owner = state.tiles[i].owner;
        if (owner === 1) counts.ashfarers++;
        else if (owner === 2) counts.saltkin++;
        else counts.open++;
      });
      relayControl[name] = counts;
    });
    return {
      matchId: matchId,
      snapshotTurn: state.turn,
      profile: profile.features,
      evidence: profile.evidence,
      candidates: cards,
      recentMatches: memory.matches.slice(-5),
      publicState: {
        turn: state.turn,
        maxTurns: E.MAX_TURNS || 15,
        land: { ashfarers: E.landCount(state, 1), saltkin: E.landCount(state, 2) },
        tokens: {
          ashfarers: state.tokens && state.tokens[1] || 0,
          saltkin: state.tokens && state.tokens[2] || 0,
          cap: E.TOKEN_CAP || 2
        },
        fertileSites: fertileSiteControl(state),
        beaconPoints: { ashfarers: state.bp[1], saltkin: state.bp[2] },
        beaconOwner: state.tiles[state.beacon].owner,
        beaconSupplied: !state.tiles[state.beacon].owner ||
          state.supply[state.beacon] === state.tiles[state.beacon].owner,
        fieldCommandsPerTurn: E.FIELD_COMMANDS,
        relayControl: relayControl,
        warnedEvent: state.pending ? {
          template: state.pending.template,
          region: state.pending.region,
          affected: (state.pending.affected || []).slice(),
          fireTurn: state.pending.fireTurn
        } : null
      }
    };
  }

  function completeMatch(state) {
    var memory = load();
    var profile = build(state, memory);
    memory.matches.push({
      tactic: profile.currentTactic,
      features: profile.features,
      turns: state.stats.length,
      result: state.over ? state.over.winner : 0
    });
    memory.matches = memory.matches.slice(-5);
    save(memory);
    return memory;
  }

  function shouldRequestDoctrine(input) {
    if (input.pending || input.lastRequestTurn === input.turn) return false;
    if (!input.hasDoctrine) return true;
    return input.uses >= 2;
  }

  return { VERSION: VERSION, STORAGE_KEY: STORAGE_KEY, load: load, clear: clear,
           build: build, strategyCandidates: strategyCandidates, resolveStrategyCard: resolveStrategyCard,
           fertileSiteControl: fertileSiteControl, requestPayload: requestPayload, completeMatch: completeMatch,
           shouldRequestDoctrine: shouldRequestDoctrine };
})();
