/* ============================================================
   profile.js — privacy-preserving player adaptation
   Derives aggregate behaviour only from resolved public history. The current
   order queue never enters this module or an AI request.
   ============================================================ */
CF.profile = (function () {
  var E = CF.engine, EV = CF.events;
  var STORAGE_KEY = 'cinderfall.player-memory.v1';
  var VERSION = 1;

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
  function tactic(spend) {
    var keys = ['raid', 'expand', 'fortify'];
    keys.sort(function (a, b) { return spend[b] - spend[a] || a.localeCompare(b); });
    return spend[keys[0]] ? keys[0].toUpperCase() : 'NONE';
  }

  function build(state, memory) {
    memory = memory || load();
    var totalTargets = 0, nearBeacon = 0, north = 0, south = 0;
    var fortifySpend = 0, highFortifySpend = 0;
    var cutOffTileTurns = 0, ownedTileTurns = 0;
    var warning = { avoid: 0, fortify: 0, press: 0 };
    var spend = { raid: 0, expand: 0, fortify: 0 };
    state.stats.forEach(function (stat) {
      cutOffTileTurns += stat.cutOffA || 0;
      ownedTileTurns += stat.landA || 0;
      var list = stat.settledOrders && stat.settledOrders[1] ? stat.settledOrders[1] : [];
      list.forEach(function (o) {
        totalTargets++;
        spend[o.type] += o.cost || E.COST[o.type] || 0;
        var x = o.to % state.W, y = (o.to / state.W) | 0;
        var historicBeacon = stat.beaconTile == null ? state.beacon : stat.beaconTile;
        var historicBx = historicBeacon % state.W, historicBy = (historicBeacon / state.W) | 0;
        if (Math.abs(x - historicBx) + Math.abs(y - historicBy) <= 2) nearBeacon++;
        if (y < state.H / 2) north++; else south++;
        if (o.type === 'fortify') {
          fortifySpend += o.cost || 1;
          if (o.targetElev >= 2) highFortifySpend += o.cost || 1;
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
        high_ground_turtle: ratio(highFortifySpend, fortifySpend),
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
        high_ground_fortify_spend: highFortifySpend,
        total_fortify_spend: fortifySpend,
        cut_off_tile_turns: cutOffTileTurns,
        owned_tile_turns: ownedTileTurns,
        warning_avoid_orders: warning.avoid,
        warning_fortify_orders: warning.fortify,
        warning_press_orders: warning.press,
        previous_match_tactic: previous ? previous.tactic : 'NONE'
      },
      currentTactic: tactic(spend)
    };
  }

  function requestPayload(state, matchId) {
    var memory = load();
    var profile = build(state, memory);
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
      recentMatches: memory.matches.slice(-5),
      publicState: {
        turn: state.turn,
        land: { ashfarers: E.landCount(state, 1), saltkin: E.landCount(state, 2) },
        income: { ashfarers: E.income(state, 1), saltkin: E.income(state, 2) },
        reserve: {
          ashfarers: state.reserve && state.reserve[1] || 0,
          saltkin: state.reserve && state.reserve[2] || 0
        },
        availableBudget: {
          ashfarers: E.availableBudget(state, 1),
          saltkin: E.availableBudget(state, 2)
        },
        beaconPoints: { ashfarers: state.bp[1], saltkin: state.bp[2] },
        beaconOwner: state.tiles[state.beacon].owner,
        beaconSupplied: !state.tiles[state.beacon].owner ||
          state.supply[state.beacon] === state.tiles[state.beacon].owner,
        fieldCommandsPerTurn: E.FIELD_COMMANDS,
        secondCommandMobilizationCost: E.MOBILIZATION_COST,
        operationSupportCost: E.SUPPORT_COST,
        openingFocus: state.opening ? state.opening.route : null,
        mainEffort: state.strategy && state.strategy[2] ? state.strategy[2] : null,
        relayControl: relayControl,
        cinderPressure: state.pressure ? {
          staleTurns: state.pressure.staleTurns,
          bridgeTurns: state.pressure.bridgeTurns
        } : { staleTurns: 0, bridgeTurns: 0 },
        warnedEvent: state.pending ? {
          template: state.pending.template,
          region: state.pending.region,
          intensity: state.pending.intensity,
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
    if (input.uses >= 3) return true;
    return input.uses >= 2 && (input.lostLand >= 3 || input.beaconChanged || input.worldChanged);
  }

  return { VERSION: VERSION, STORAGE_KEY: STORAGE_KEY, load: load, clear: clear,
           build: build, requestPayload: requestPayload, completeMatch: completeMatch,
           shouldRequestDoctrine: shouldRequestDoctrine };
})();
