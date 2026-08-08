/* ============================================================
   mapgen.js — the double-route ladder ring

   Two broad east/west fronts run north and south of the caldera. Two
   rotationally mirrored cross-caldera bridges join those fronts. They are
   cross-connections, not a third capital route: a breakthrough on one front
   can turn through a bridge and enter the rear of the other front.

   The topology is fixed so every generated map supports that manoeuvre.
   Elevation, fertility, the Beacon, and harmless outer fringe tiles remain
   procedural and exactly 180-degree rotationally symmetric.
   ============================================================ */
CF.mapgen = (function () {
  var U = CF.util;

  var W = 14, H = 10;
  var CX = (W - 1) / 2, CY = (H - 1) / 2;

  function idx(x, y) { return y * W + x; }
  function twin(i) { return W * H - 1 - i; }

  function blankTile() {
    return {
      land: false, elev: 0, fert: 0, owner: 0, str: 0,
      capital: 0, crater: 0, born: 0,
      route: null, bridge: null, relay: null, temporaryBridge: 0,
      pressureReserved: 0
    };
  }

  function mark(tiles, x, y, route, bridge) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    var t = tiles[idx(x, y)];
    t.land = true;
    if (route) t.route = route;
    if (bridge) t.bridge = bridge;
  }

  function generate(seed) {
    var holder = { seed: seed | 0 };
    var rand = U.rng(holder);
    var tiles = new Array(W * H);
    for (var i = 0; i < tiles.length; i++) tiles[i] = blankTile();

    // Two two-tile-wide fronts. Width matters: no Relay landing can become a
    // single invulnerable fortress, and attacks can approach from two sources.
    for (var x = 1; x <= 12; x++) {
      mark(tiles, x, 2, 'north');
      mark(tiles, x, 3, 'north');
      mark(tiles, x, 6, 'south');
      mark(tiles, x, 7, 'south');
    }

    // Capital fans connect each seat to both routes without adding a middle
    // east/west corridor.
    for (var y = 3; y <= 6; y++) {
      mark(tiles, 1, y, y < 5 ? 'north' : 'south');
      mark(tiles, 2, y, y < 5 ? 'north' : 'south');
      mark(tiles, 11, y, y < 5 ? 'north' : 'south');
      mark(tiles, 12, y, y < 5 ? 'north' : 'south');
    }

    // The two permanent cross-caldera bridges. Each is two tiles wide and the
    // eastern bridge is the exact rotational twin of the western bridge.
    [[3, 4, 'west'], [9, 10, 'east']].forEach(function (spec) {
      for (var bx = spec[0]; bx <= spec[1]; bx++) {
        mark(tiles, bx, 4, 'cross', spec[2]);
        mark(tiles, bx, 5, 'cross', spec[2]);
      }
    });

    // Procedural fringe creates an island silhouette without changing the
    // ladder's connectivity. Only the western half decides; twins are copied.
    for (var fx = 2; fx <= 6; fx++) {
      if (rand() < 0.42) mark(tiles, fx, 1, 'north');
      if (rand() < 0.42) mark(tiles, fx, 8, 'south');
    }
    for (var fi = 0; fi < W * H / 2; fi++) {
      var fj = twin(fi);
      if (tiles[fi].land && !tiles[fj].land) {
        tiles[fj].land = true;
        tiles[fj].route = tiles[fi].route === 'north' ? 'south'
          : tiles[fi].route === 'south' ? 'north' : tiles[fi].route;
      }
    }

    // A central two-by-two cooled-lava bridge is reserved for Cinder Pressure.
    // It starts as water and may open temporarily after prolonged stillness.
    var pressureBridge = [];
    for (var px = 6; px <= 7; px++) {
      for (var py = 4; py <= 5; py++) {
        var pi = idx(px, py);
        pressureBridge.push(pi);
        tiles[pi] = blankTile();
        tiles[pi].pressureReserved = 1;
      }
    }

    // Terrain value is mirrored exactly. Caldera-facing ground is fertile;
    // seaward ground is higher, preserving the original risk/reward tension.
    for (var ti = 0; ti < W * H / 2; ti++) {
      var src = tiles[ti], dst = tiles[twin(ti)];
      if (src.land) {
        var sy = (ti / W) | 0;
        var outward = Math.abs(sy - CY) / CY;
        var jitter = U.hash32(ti * 3121 + seed * 71) - 0.5;
        src.elev = U.clamp(Math.round(1 + outward * 2.2 + jitter), 1, 3);
        src.fert = U.clamp(Math.round(2.5 - outward * 1.8 + jitter * 1.4), 0, 3);
        if (src.elev === 3) src.fert = Math.max(0, src.fert - 1);
      }
      dst.land = src.land;
      dst.elev = src.elev;
      dst.fert = src.fert;
      if (!dst.route) {
        dst.route = src.route === 'north' ? 'south'
          : src.route === 'south' ? 'north' : src.route;
      }
    }

    // Relay zones span both rows of a route. Taking one square can weaken a
    // junction; taking both severs that lane unless another controlled bridge
    // provides a way around it.
    var relays = {
      NW: [idx(4, 2), idx(4, 3)],
      SW: [idx(4, 6), idx(4, 7)],
      NE: [idx(9, 2), idx(9, 3)],
      SE: [idx(9, 6), idx(9, 7)]
    };
    Object.keys(relays).forEach(function (name) {
      relays[name].forEach(function (ri) {
        tiles[ri].relay = name;
        tiles[ri].fert = 0;  // a tactical junction, never a bonus income point
        tiles[ri].elev = 1;  // broad and attackable, not a new hill fortress
      });
    });

    // Capital seats are fixed by topology and rotationally symmetric.
    var capA = idx(1, 4), capB = twin(capA);
    seat(tiles, capA, 1);
    seat(tiles, capB, 2);
    seedHome(tiles, capA);

    // One shared opening objective breaks strategic mirror-play without
    // favouring a capital: both sides are the same distance from the chosen
    // route and its Beacon. The other route remains the flank.
    var openingFocus = U.hash32(seed * 65537 + 911) < 0.5 ? 'NORTH' : 'SOUTH';
    var beacon = pickBeacon(tiles, capA, capB, seed, openingFocus);
    return {
      W: W, H: H, tiles: tiles,
      capitals: { 1: capA, 2: capB },
      beacon: beacon, relays: relays, pressureBridge: pressureBridge,
      openingFocus: openingFocus,
      seed: seed | 0, rngSeed: holder.seed
    };
  }

  function seat(tiles, i, owner) {
    var t = tiles[i];
    t.land = true;
    t.owner = owner;
    t.capital = owner;
    t.elev = 3;
    t.fert = 2;
    t.str = 6;
  }

  function seedHome(tiles, cap) {
    // One foothold toward each front. The eastern starts are exact twins.
    [idx(1, 3), idx(1, 5)].forEach(function (i) {
      var j = twin(i);
      tiles[i].owner = 1;
      tiles[i].str = 2;
      tiles[j].owner = 2;
      tiles[j].str = 2;
    });
  }

  function walkDistances(tiles, from) {
    var d = new Int16Array(W * H).fill(-1);
    var q = [from];
    d[from] = 0;
    for (var h = 0; h < q.length; h++) {
      var i = q[h], ns = neighbors(i);
      for (var k = 0; k < ns.length; k++) {
        var n = ns[k];
        if (d[n] >= 0 || !tiles[n].land) continue;
        d[n] = d[i] + 1;
        q.push(n);
      }
    }
    return d;
  }

  function pickBeacon(tiles, capA, capB, seed, openingFocus) {
    var da = walkDistances(tiles, capA), db = walkDistances(tiles, capB);
    var bestScore = -Infinity, choices = [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (!t.land || t.owner || t.relay || da[i] < 0 || db[i] < 0) continue;
      var lane = t.route === 'north' ? 'NORTH' : t.route === 'south' ? 'SOUTH'
        : ((i / W) | 0) < H / 2 ? 'NORTH' : 'SOUTH';
      if (lane !== openingFocus) continue;
      var score = -Math.abs(da[i] - db[i]) * 20 + Math.min(da[i], db[i]) * 3 - t.fert;
      if (score > bestScore) { bestScore = score; choices = [i]; }
      else if (score === bestScore) choices.push(i);
    }
    if (!choices.length) return idx(6, openingFocus === 'NORTH' ? 2 : 7);
    return choices[Math.floor(U.hash32(seed * 104729) * choices.length)];
  }

  function neighbors(i) {
    var x = i % W, y = (i / W) | 0, out = [];
    if (x > 0) out.push(i - 1);
    if (x < W - 1) out.push(i + 1);
    if (y > 0) out.push(i - W);
    if (y < H - 1) out.push(i + W);
    return out;
  }

  return {
    W: W, H: H, generate: generate, neighbors: neighbors,
    idx: idx, twin: twin
  };
})();
