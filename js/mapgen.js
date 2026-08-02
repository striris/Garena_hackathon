/* ============================================================
   mapgen.js — the ring
   Cinder sits under the middle of the map, so the centre is deep
   water and the land is an annulus around its mouth. Two arcs, north
   and south, are the only ways between the capitals: that is what
   makes an earthquake through one of them frightening.

   The ring is scarce on purpose. There is not enough steady ground
   for both peoples, and the whole game depends on that being true
   by about turn five.

   The map is built with 180-degree rotational symmetry about the
   caldera — tile (x,y) is the twin of (W-1-x, H-1-y). Neither people
   starts on better ground than the other, and any imbalance in a
   match is the players' doing or the mountain's.
   ============================================================ */
CF.mapgen = (function () {
  var U = CF.util;

  var W = 14, H = 10;
  var CX = (W - 1) / 2, CY = (H - 1) / 2;   // 6.5, 4.5 — the caldera
  var AX = 5.9, AY = 3.9;                   // ring semi-axes

  function idx(x, y) { return y * W + x; }
  function twin(i) { return W * H - 1 - i; }

  function blankTile() {
    return { land: false, elev: 0, fert: 0, owner: 0, str: 0, capital: 0, crater: 0, born: 0 };
  }

  // elliptical radius: 1.0 is the centreline of the ring
  function ringR(x, y) {
    var dx = (x - CX) / AX, dy = (y - CY) / AY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function generate(seed) {
    var holder = { seed: seed | 0 };
    var rand = U.rng(holder);

    var tiles = new Array(W * H);
    for (var i = 0; i < W * H; i++) tiles[i] = blankTile();

    // --- the annulus ------------------------------------------------------
    // Kept deliberately thin. Land here is young, and generous, and there
    // is not enough of it for both peoples — which has to be true on the
    // board by about turn five or the game has no argument in it.
    var half = 0.215 + rand() * 0.05;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var r = ringR(x, y);
        // noise breaks the band into islands, which is the point: a ring
        // of islands, not a doughnut
        var n = (U.hash32(x * 7349 + y * 91711 + seed * 13) - 0.5) * 0.22;
        if (Math.abs(r - 1) + n < half) tiles[idx(x, y)].land = true;
      }
    }

    // --- keep the loop closed --------------------------------------------
    // Trace the centreline so the ring is always walkable both ways round.
    // Without this, noise can strand a capital and the match is over before
    // it starts.
    for (var a = 0; a < Math.PI * 2; a += 0.02) {
      var tx = Math.round(CX + Math.cos(a) * AX);
      var ty = Math.round(CY + Math.sin(a) * AY);
      if (tx >= 0 && tx < W && ty >= 0 && ty < H) tiles[idx(tx, ty)].land = true;
    }

    // --- the mountain's mouth stays open ----------------------------------
    for (var y2 = 0; y2 < H; y2++)
      for (var x2 = 0; x2 < W; x2++)
        if (ringR(x2, y2) < 0.62) { tiles[idx(x2, y2)].land = false; }

    // --- height and soil --------------------------------------------------
    // The seaward rim is old stone, tall and barren. The caldera side is
    // young: low, and thick with ash. So the rich ground is the ground you
    // cannot easily hold, which is the argument the whole game is about.
    for (var i2 = 0; i2 < W * H; i2++) {
      var t = tiles[i2];
      if (!t.land) continue;
      var px = i2 % W, py = (i2 / W) | 0;
      var rr = ringR(px, py);
      var outward = rr - 1;                    // <0 caldera side, >0 seaward
      var jitter = U.hash32(i2 * 3121 + seed * 71) - 0.5;

      t.elev = U.clamp(Math.round(2 + outward * 5.0 + jitter * 1.2), 1, 3);
      t.fert = U.clamp(Math.round(0.9 - outward * 5.4 + jitter * 1.3), 0, 3);
      if (t.elev === 3) t.fert = Math.max(0, t.fert - 1);
    }

    // --- make it exactly fair --------------------------------------------
    // Copy the western half onto the eastern half, rotated through the
    // caldera. Every square now has a twin of identical worth.
    for (var i3 = 0; i3 < W * H / 2; i3++) {
      var src = tiles[i3], dstIdx = twin(i3);
      var d = tiles[dstIdx];
      d.land = src.land; d.elev = src.elev; d.fert = src.fert;
    }

    // --- capitals ---------------------------------------------------------
    var capA = bestCapital(tiles);
    if (capA < 0) return generate((seed + 977) | 0);
    var capB = twin(capA);

    seat(tiles, capA, 1);
    seat(tiles, capB, 2);
    seedHome(tiles, capA);

    // --- the Beacon -------------------------------------------------------
    var beacon = pickBeacon(tiles, capA, capB);

    return { W: W, H: H, tiles: tiles, capitals: { 1: capA, 2: capB },
             beacon: beacon, seed: seed | 0, rngSeed: holder.seed };
  }

  // The western seat: on the ring, well out toward the rim, with room to
  // grow. Its twin becomes the eastern seat, so this one choice fixes both.
  function bestCapital(tiles) {
    var best = -1, bestScore = -1e9;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < 5; x++) {
        var i = idx(x, y), t = tiles[i];
        if (!t.land) continue;
        var room = 0, ns = neighbors(i);
        for (var k = 0; k < ns.length; k++) if (tiles[ns[k]].land) room++;
        if (room < 2) continue;                       // no dead-end capitals
        var score = room * 3 + t.elev + (4 - x) * 2;
        if (score > bestScore) { bestScore = score; best = i; }
      }
    }
    return best;
  }

  function seat(tiles, i, owner) {
    var t = tiles[i];
    t.land = true; t.owner = owner; t.capital = owner;
    t.elev = 3; t.fert = 2; t.str = 6;
  }

  // Two fields each. Only the western side chooses — the eastern side is
  // handed the exact twins. Choosing independently looks equivalent but is
  // not: rotation reverses index order, so on a tie the two sides picked
  // different squares, and that ~1 tile of asymmetry per map was enough to
  // skew several hundred simulated matches badly.
  function seedHome(tiles, cap) {
    var ns = neighbors(cap).filter(function (n) { return tiles[n].land && tiles[n].owner === 0; });
    ns.sort(function (a, b) { return tiles[b].fert - tiles[a].fert || a - b; });
    for (var k = 0; k < ns.length && k < 2; k++) {
      var i = ns[k], j = twin(i);
      if (tiles[j].owner !== 0 || !tiles[j].land) continue;   // never overwrite a capital
      tiles[i].owner = 1; tiles[i].str = 2;
      tiles[j].owner = 2; tiles[j].str = 2;
    }
  }

  // The fire wants open ground the same distance from both peoples. On a
  // ring, straight-line distance lies — the sea is in the way — so this
  // walks the actual land to find the midpoint of an arc.
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

  function pickBeacon(tiles, capA, capB) {
    var da = walkDistances(tiles, capA), db = walkDistances(tiles, capB);
    var best = -1, bestScore = -1e9;
    for (var i = 0; i < W * H; i++) {
      var t = tiles[i];
      if (!t.land || t.owner !== 0 || da[i] < 0 || db[i] < 0) continue;
      // dead level between them, and as far from both as the ring allows
      var score = -Math.abs(da[i] - db[i]) * 10 + Math.min(da[i], db[i]) * 2 - t.fert;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best >= 0 ? best : idx(W >> 1, 0);
  }

  function neighbors(i) {
    var x = i % W, y = (i / W) | 0, out = [];
    if (x > 0) out.push(i - 1);
    if (x < W - 1) out.push(i + 1);
    if (y > 0) out.push(i - W);
    if (y < H - 1) out.push(i + W);
    return out;
  }

  return { W: W, H: H, generate: generate, neighbors: neighbors, idx: idx, twin: twin };
})();
