/* ============================================================
   events.js — what the mountain is allowed to do
   Ten templates. Cinder cannot invent anything; it picks one of
   these and chooses an intensity and a region. Ten by three by
   five is a hundred and fifty outcomes we have already balanced.

   apply(state, event) is pure: same map in, same map out.
   That is what lets the validator simulate an event, look at the
   damage, and refuse it before anything reaches the screen.
   ============================================================ */
CF.events = (function () {
  var U = CF.util, E = CF.engine;

  var REGIONS = ['north', 'south', 'east', 'west', 'centre'];

  function regionName(r) {
    return r === 'centre' ? 'the heart of the ring' : 'the ' + r;
  }

  function inRegion(state, i, region) {
    var W = state.W, H = state.H, x = i % W, y = (i / W) | 0;
    switch (region) {
      case 'north':  return y <= H * 0.42;
      case 'south':  return y >= H * 0.58 - 1;
      case 'west':   return x <= W * 0.38;
      case 'east':   return x >= W * 0.62 - 1;
      case 'centre': return x > W * 0.28 && x < W * 0.72 && y > H * 0.22 && y < H * 0.78;
      default:       return true;
    }
  }

  function tilesIn(state, region, filter) {
    var out = [];
    for (var i = 0; i < state.tiles.length; i++)
      if (inRegion(state, i, region) && (!filter || filter(state.tiles[i], i))) out.push(i);
    return out;
  }

  function isLand(t) { return t.land; }
  function isWater(t) { return !t.land && !t.pressureReserved; }

  // Sinking a square is the one destructive primitive. Capitals are
  // never destroyed — that is a hard rule, checked here and again in
  // the validator.
  function sink(state, i, fx) {
    var t = state.tiles[i];
    if (!t.land || t.capital || t.relay) return false;
    t.land = false; t.owner = 0; t.str = 0; t.elev = 0; t.fert = 0; t.crater = 0;
    fx.push({ kind: 'sink', at: i });
    return true;
  }

  function raise(state, i, fx, elev, fert) {
    var t = state.tiles[i];
    if (t.land || t.pressureReserved) return false;
    t.land = true; t.owner = 0; t.str = 0;
    t.elev = elev; t.fert = fert; t.born = state.turn;
    fx.push({ kind: 'rise', at: i });
    return true;
  }

  // ------------------------------------------------------------ templates
  var TEMPLATES = {

    eruption: {
      name: 'ERUPTION',
      blurb: 'Cinder breathes. Land is destroyed, and the ring around the crater becomes the richest soil on the map.',
      warn: function (ev) { return 'The mountain is shaking in ' + regionName(ev.region) + '.'; },
      run: function (s, ev, rand, fx) {
        var cands = tilesIn(s, ev.region, function (t) { return t.land && !t.capital && !t.relay; });
        if (!cands.length) cands = tilesIn(s, 'centre', function (t) { return t.land && !t.capital && !t.relay; });
        if (!cands.length) return null;
        // the mouth opens where the land is worth most — the wreckage
        // has to be a prize, not a footnote
        cands.sort(function (a, b) {
          return score(s, b) - score(s, a);
        });
        var centre = cands[Math.min(cands.length - 1, Math.floor(rand() * 2))];
        var radius = ev.intensity;          // 1, 2 or 3
        var cx = centre % s.W, cy = (centre / s.W) | 0;
        var destroyed = 0, blessed = 0;

        for (var i = 0; i < s.tiles.length; i++) {
          var x = i % s.W, y = (i / s.W) | 0;
          var d = Math.abs(x - cx) + Math.abs(y - cy);
          if (d < radius) { if (sink(s, i, fx)) destroyed++; }
          else if (d <= radius + 1) {
            var t = s.tiles[i];
            if (t.land) { t.fert = 3; t.crater = 1; blessed++; fx.push({ kind: 'bless', at: i }); }
          }
        }
        fx.push({ kind: 'quake', power: 1.6 + ev.intensity * 0.7 });
        fx.push({ kind: 'shock', at: centre, r: radius + 1.6 });
        return { at: centre,
          message: 'Cinder opened its mouth in ' + regionName(ev.region) + '. ' +
                   U.plural(destroyed, 'square') + ' gone, ' + blessed + ' buried in the best soil on the map.' };
      }
    },

    tide: {
      name: 'THE TIDE ANSWERS',
      blurb: 'All low ground sinks. It punishes whoever built low, by exactly the same rule for both sides.',
      warn: function (ev) { return 'The water is rising against the low ground of ' + regionName(ev.region) + '.'; },
      run: function (s, ev, rand, fx) {
        var low = tilesIn(s, ev.region, function (t) { return t.land && t.elev <= 1 && !t.capital && !t.relay; });
        if (!low.length) return null;
        low.sort(function (a, b) { return s.tiles[a].fert - s.tiles[b].fert; });
        var take = Math.max(1, Math.round(low.length * (0.28 + 0.24 * ev.intensity)));
        var gone = 0;
        for (var k = 0; k < take && k < low.length; k++) if (sink(s, low[k], fx)) gone++;
        fx.push({ kind: 'flood', region: ev.region });
        return { at: low[0],
          message: 'The sea took back ' + U.plural(gone, 'low square') + ' in ' + regionName(ev.region) + '. Height was never a courtesy.' };
      }
    },

    earthquake: {
      name: 'EARTHQUAKE',
      blurb: 'A line of land drops into the sea, cutting supply lines. Splitting a territory hurts more than shrinking it.',
      warn: function (ev) { return 'The ground is splitting across ' + regionName(ev.region) + '.'; },
      run: function (s, ev, rand, fx) {
        // Find the seam that cuts the most supply inside the warned region,
        // not just the most land anywhere on the map.
        var best = null, bestScore = -1;
        for (var col = 1; col < s.W - 1; col++) {
          var sc = seamScore(s, col, 'v', ev.region);
          if (sc > bestScore) { bestScore = sc; best = { line: col, dir: 'v' }; }
        }
        for (var row = 1; row < s.H - 1; row++) {
          var sr = seamScore(s, row, 'h', ev.region);
          if (sr > bestScore) { bestScore = sr; best = { line: row, dir: 'h' }; }
        }
        if (!best) return null;

        var gone = 0, first = -1;
        for (var i = 0; i < s.tiles.length; i++) {
          var x = i % s.W, y = (i / s.W) | 0;
          var on = best.dir === 'v' ? x === best.line : y === best.line;
          if (!on || !inRegion(s, i, ev.region)) continue;
          // intensity 1 tears every other square, 3 tears the whole seam
          if (ev.intensity < 3 && ((best.dir === 'v' ? y : x) % (4 - ev.intensity)) !== 0) continue;
          if (sink(s, i, fx)) { gone++; if (first < 0) first = i; }
        }
        fx.push({ kind: 'quake', power: 2.4 });
        fx.push({ kind: 'rift', line: best.line, dir: best.dir, region: ev.region });
        return { at: first < 0 ? 0 : first,
          message: 'A seam opened in ' + regionName(ev.region) + ' and ' + U.plural(gone, 'square') +
            ' fell into the sea. Roads home are shorter than they were.' };
      }
    },

    new_island: {
      name: 'NEW ISLAND',
      blurb: 'Fresh empty land rises, dropped exactly where it will cause the most trouble.',
      warn: function (ev) { return 'The water is boiling in ' + regionName(ev.region) + '. Something is coming up.'; },
      run: function (s, ev, rand, fx) {
        // land is only interesting if both sides can reach it
        var water = tilesIn(s, ev.region, isWater);
        if (!water.length) water = tilesIn(s, 'centre', isWater);
        if (!water.length) return null;
        water.sort(function (a, b) { return contestScore(s, b) - contestScore(s, a); });
        var seedTile = water[0];
        var n = 1 + ev.intensity, made = 0;
        var queue = [seedTile], seen = {};
        seen[seedTile] = 1;
        while (queue.length && made < n) {
          var i = queue.shift();
          if (raise(s, i, fx, 1 + (made === 0 ? 1 : 0), 2 + (ev.intensity > 1 ? 1 : 0))) made++;
          var ns = E.neighbors(s, i);
          for (var k = 0; k < ns.length; k++)
            if (!seen[ns[k]] && !s.tiles[ns[k]].land) { seen[ns[k]] = 1; queue.push(ns[k]); }
        }
        fx.push({ kind: 'shock', at: seedTile, r: 2 });
        return { at: seedTile,
          message: U.plural(made, 'new square') + ' pushed up out of the water in ' + regionName(ev.region) + '. It belongs to nobody yet.' };
      }
    },

    ashfall: {
      name: 'ASHFALL',
      blurb: 'The sky closes and raids cost double. It slows a runaway attacker without taking anyone\'s land.',
      warn: function () { return 'The sky is closing over the whole ring.'; },
      run: function (s, ev, rand, fx) {
        s.mods.ashfall = 1 + ev.intensity;
        fx.push({ kind: 'skyDark', turns: s.mods.ashfall });
        return { at: s.beacon,
          message: 'Ash blots out the sky for ' + U.plural(s.mods.ashfall, 'turn') + '. Every raid costs double.' };
      }
    },

    bloom: {
      name: 'BLOOM',
      blurb: 'Rain enriches neutral ground on a quiet front, creating a fair reason for both sides to contest it.',
      warn: function (ev) { return 'Rain is gathering over ' + regionName(ev.region) + '.'; },
      run: function (s, ev, rand, fx) {
        // A Bloom is an opportunity, not a hidden subsidy. Prefer open land
        // that both sides can contest; only fall back to land generally when
        // the chosen front has been fully claimed.
        var land = tilesIn(s, ev.region, function (t) {
          return t.land && t.owner === 0 && !t.relay && !t.capital;
        });
        if (!land.length) land = tilesIn(s, ev.region, isLand);
        if (!land.length) return null;
        land.sort(function (a, b) { return contestScore(s, b) - contestScore(s, a) || a - b; });
        var lifted = 0;
        land.slice(0, 2 + ev.intensity).forEach(function (i) {
          var t = s.tiles[i];
          var before = t.fert;
          t.fert = U.clamp(t.fert + ev.intensity, 0, 3);
          if (t.fert > before) { lifted++; fx.push({ kind: 'bless', at: i }); }
        });
        return { at: land[0],
          message: 'Rain fell on ' + regionName(ev.region) + '. ' + U.plural(lifted, 'square') + ' turned green. Quiet ground is not quiet any more.' };
      }
    },

    beacon_move: {
      name: 'THE FIRE MOVES',
      blurb: 'The Beacon goes out and relights somewhere else. This is how the mountain starts a war without touching anybody.',
      warn: function () { return 'The fire on the tower is guttering.'; },
      run: function (s, ev, rand, fx) {
        var from = s.beacon;
        var capA = s.capitals[1], capB = s.capitals[2];
        var ax = capA % s.W, ay = (capA / s.W) | 0;
        var bx = capB % s.W, by = (capB / s.W) | 0;
        var best = -1, bestScore = -1e9;
        for (var i = 0; i < s.tiles.length; i++) {
          var t = s.tiles[i];
          if (!t.land || i === from || t.capital) continue;
          var x = i % s.W, y = (i / s.W) | 0;
          var da = Math.abs(x - ax) + Math.abs(y - ay);
          var db = Math.abs(x - bx) + Math.abs(y - by);
          // open ground, dead level between the two capitals
          var sc = -Math.abs(da - db) * 4 + (t.owner === 0 ? 6 : 0) - t.str * 0.4 + rand() * 2;
          if (ev.intensity >= 3) sc += (t.owner === 0 ? 4 : -4);   // deep in nobody's land
          if (sc > bestScore) { bestScore = sc; best = i; }
        }
        if (best < 0) return null;
        s.beacon = best;
        fx.push({ kind: 'beaconMove', from: from, to: best });
        return { at: best,
          message: 'The fire went out on the old tower and relit in open ground between you. It was never yours to keep.' };
      }
    },

    rock_cools: {
      name: 'THE ROCK COOLS',
      blurb: 'High ground stops giving any defence. Every fortress becomes a field with a lot of people standing on it.',
      warn: function () { return 'The high ground is crumbling everywhere.'; },
      run: function (s, ev, rand, fx) {
        s.mods.rockCooled = 1 + ev.intensity;
        fx.push({ kind: 'cool', turns: s.mods.rockCooled });
        return { at: s.beacon,
          message: 'The rock has gone cold and brittle. For ' + U.plural(s.mods.rockCooled, 'turn') + ', height protects nobody.' };
      }
    },

    settlers: {
      name: 'SETTLERS',
      blurb: 'A third people land on empty ground and hold it. Neither side asked for a neighbour.',
      warn: function (ev) { return 'Strange sails on the water off ' + regionName(ev.region) + '.'; },
      run: function (s, ev, rand, fx) {
        var open = tilesIn(s, ev.region, function (t) { return t.land && t.owner === 0; });
        if (open.length < 1) open = tilesIn(s, null, function (t) { return t.land && t.owner === 0; });
        if (!open.length) return null;
        open.sort(function (a, b) { return contestScore(s, b) - contestScore(s, a); });
        var n = Math.min(open.length, 1 + ev.intensity), first = open[0];
        for (var k = 0; k < n; k++) {
          var t = s.tiles[open[k]];
          t.owner = 3; t.str = 2 + ev.intensity;
          fx.push({ kind: 'settle3', at: open[k] });
        }
        return { at: first,
          message: 'A third people came ashore in ' + regionName(ev.region) + ' and took ' + U.plural(n, 'square') + '. They did not ask.' };
      }
    },

    storm: {
      name: 'STORM SEASON',
      blurb: 'Combat swings by up to two either way. It quietly helps whoever is losing.',
      warn: function () { return 'Weather is turning over the whole ring.'; },
      run: function (s, ev, rand, fx) {
        s.mods.storm = 2 + ev.intensity;
        fx.push({ kind: 'storm', turns: s.mods.storm });
        return { at: s.beacon,
          message: 'Storm season for ' + U.plural(s.mods.storm, 'turn') + '. The weather has taken the side of whoever is behind.' };
      }
    }
  };

  // ---------------------------------------------------------- scoring aids
  function score(s, i) {
    // how much this square is worth as a target: owned, fertile, defended
    var t = s.tiles[i];
    return (t.owner ? 3 : 0) + t.fert * 2 + t.str * 0.5 + t.elev;
  }

  function contestScore(s, i) {
    // squares that touch both peoples, or sit between them, cause trouble
    var ns = E.neighbors(s, i), a = 0, b = 0;
    for (var k = 0; k < ns.length; k++) {
      if (s.tiles[ns[k]].owner === 1) a++;
      if (s.tiles[ns[k]].owner === 2) b++;
    }
    return (a && b ? 10 : 0) + a + b;
  }

  function seamScore(s, line, dir, region) {
    // A seam is worth tearing if it carries a lot of somebody's supply in
    // the place that was actually warned. Tiles outside it do not influence
    // the choice and cannot be damaged by the resulting earthquake.
    var total = 0;
    for (var i = 0; i < s.tiles.length; i++) {
      var x = i % s.W, y = (i / s.W) | 0;
      if (dir === 'v' ? x !== line : y !== line) continue;
      if (!inRegion(s, i, region)) continue;
      var t = s.tiles[i];
      if (!t.land) continue;
      if (t.capital || t.relay) return -1;    // capitals and Relay infrastructure survive
      total += t.owner ? 3 : 1;
    }
    return total;
  }

  // ------------------------------------------------------------ public API
  // Pure: clone in, clone out. The validator leans on this.
  function apply(state, ev) {
    var s = U.deepClone(state);
    var holder = { seed: s.rngSeed };
    var rand = U.rng(holder);
    var fx = [];
    var tpl = TEMPLATES[ev.template];
    if (!tpl) return { state: state, fx: [], ok: false };

    var out = tpl.run(s, ev, rand, fx);
    s.rngSeed = holder.seed;
    if (!out) return { state: state, fx: [], ok: false };

    s.supply = E.computeSupply(s);
    return { state: s, fx: fx, ok: true, at: out.at, message: out.message };
  }

  function warningFor(ev) {
    var tpl = TEMPLATES[ev.template];
    return tpl ? tpl.warn(ev) : 'Something is coming.';
  }

  // Events held by the designer pause remain due. Equality loses an event as
  // soon as the turn advances, so every controller uses this overdue-safe test.
  function isDue(ev, turn) { return !!ev && ev.fireTurn <= turn; }

  function nameOf(id) { return TEMPLATES[id] ? TEMPLATES[id].name : id; }
  function blurbOf(id) { return TEMPLATES[id] ? TEMPLATES[id].blurb : ''; }
  function all() { return Object.keys(TEMPLATES); }

  return { TEMPLATES: TEMPLATES, REGIONS: REGIONS, apply: apply, warningFor: warningFor, isDue: isDue,
           nameOf: nameOf, blurbOf: blurbOf, all: all, inRegion: inRegion, regionName: regionName };
})();
