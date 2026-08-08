/* ============================================================
   intro.js — the cold open
   Before a single order is given, the player should understand
   three things: two peoples are fighting over a ring of islands,
   there is not enough ground for both, and something is burning
   underneath them that wants it that way.

   So we show it rather than write it. The ring turns, the border
   between jade and orange grinds back and forth, and Cinder
   breathes under the middle of the map.
   ============================================================ */
CF.intro = (function () {
  var U = CF.util;

  var cv, ctx, dpr = 1, w = 0, h = 0;
  var raf = null, t0 = 0;
  var cells = [];
  var sparks = [];
  var ash = [];
  var waves = [];
  var nextErupt = 4.2;
  var erupt = -99;
  var scene = 0;
  var sceneTime = 0;

  var GW = 26, GH = 17;          // virtual grid for the hero ring

  // ------------------------------------------------------------------ init
  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    build();
    resize();
    window.addEventListener('resize', resize);
  }

  function build() {
    cells = [];
    var cx = (GW - 1) / 2, cy = (GH - 1) / 2;
    for (var y = 0; y < GH; y++) {
      for (var x = 0; x < GW; x++) {
        var dx = (x - cx) / (GW * 0.365), dy = (y - cy) / (GH * 0.365);
        var r = Math.sqrt(dx * dx + dy * dy);
        var n = (U.hash32(x * 6151 + y * 13093) - 0.5) * 0.17;
        if (Math.abs(r - 1) + n > 0.21) continue;
        var ang = Math.atan2(y - cy, x - cx);
        cells.push({
          x: x, y: y, ang: ang, r: r,
          elev: U.clamp(Math.round(2 + (r - 1) * 7 + (U.hash32(x * 31 + y * 977) - .5) * 1.4), 1, 3),
          fert: U.clamp(Math.round(1.2 - (r - 1) * 8 + (U.hash32(x * 71 + y * 13) - .5) * 1.6), 0, 3),
          seed: U.hash32(x * 101 + y * 37)
        });
      }
    }
  }

  function resize() {
    if (!cv) return;
    var r = cv.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.floor(r.width * dpr));
    cv.height = Math.max(1, Math.floor(r.height * dpr));
    w = r.width; h = r.height;
  }

  function start() {
    if (raf) return;
    t0 = performance.now();
    resize();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    var t = (now - t0) / 1000;
    draw(t);
  }

  // ------------------------------------------------------------------ draw
  function geom() {
    // fit the ring to the shorter axis, biased slightly up so the title
    // has room to breathe over it
    var ts = Math.min(w / (GW + 2), h / (GH + 2));
    return { ts: ts, ox: (w - ts * GW) / 2, oy: (h - ts * GH) / 2 };
  }

  function draw(t) {
    if (!ctx || !w) return;
    sceneTime = t;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var g = geom();
    var cxp = g.ox + g.ts * GW / 2;
    var cyp = g.oy + g.ts * GH / 2;

    var sceneDrive = scene === 4 ? 1.55 : scene === 3 ? 1.25 : 1;
    var push = (Math.sin(t * 0.42) * 0.30 + Math.sin(t * 0.17 + 1.3) * 0.16) * sceneDrive;

    // an eruption every few seconds, so the ring never looks settled
    if (t > nextErupt) { erupt = t; nextErupt = t + 7 + Math.random() * 5; }
    var ea = t - erupt;
    var eruptPulse = ea >= 0 && ea < 2.2 ? (1 - ea / 2.2) : 0;

    drawSea(t, cxp, cyp);
    drawCinder(t, cxp, cyp, g, eruptPulse);
    drawRing(t, g, push, eruptPulse, cxp, cyp);
    drawSparks(t, g, push);
    drawAsh(t);
    drawVignette();

    ctx.restore();
  }

  function drawSea(t, cxp, cyp) {
    var g = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#0d2135');
    g.addColorStop(0.55, '#07182a');
    g.addColorStop(1, '#03080f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < 7; k++) {
      ctx.beginPath();
      var yb = h * (k + 0.5) / 7;
      for (var x = 0; x <= w; x += 10) {
        var y = yb + Math.sin(x * 0.012 + t * (0.35 + k * 0.09) + k * 1.7) * (9 + k * 2.2)
                   + Math.sin(x * 0.037 - t * 0.55) * 3.5;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(90,180,235,0.05)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Cinder itself: not a mountain you can see, a heat you can. It sits
  // under the water in the middle of the ring and it is always working.
  function drawCinder(t, cxp, cyp, g, eruptPulse) {
    var R = g.ts * 7.4;
    var breathe = 0.5 + 0.5 * Math.sin(t * 0.75);
    var heat = 0.68 + breathe * 0.30 + eruptPulse * 0.8;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    var core = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, R);
    // a wide, slow falloff so the whole caldera reads as a pool of magma
    // rather than a pinprick of light behind the title
    core.addColorStop(0, 'rgba(255,238,190,' + (heat * 0.80) + ')');
    core.addColorStop(0.30, 'rgba(255,140,45,' + (heat * 0.52) + ')');
    core.addColorStop(0.62, 'rgba(190,48,10,' + (heat * 0.26) + ')');
    core.addColorStop(1, 'rgba(120,20,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(cxp - R, cyp - R, R * 2, R * 2);

    // magma cracks, turning slowly under the water
    ctx.translate(cxp, cyp);
    ctx.rotate(t * 0.06);
    for (var k = 0; k < 9; k++) {
      var a = k / 9 * Math.PI * 2;
      var wob = Math.sin(t * 1.3 + k * 2.1) * 0.13;
      ctx.save();
      ctx.rotate(a + wob);
      var len = g.ts * (4.0 + Math.sin(t * 0.9 + k) * 1.1 + eruptPulse * 2.6);
      var lg = ctx.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,205,110,' + (0.50 + eruptPulse * 0.45) + ')');
      lg.addColorStop(0.55, 'rgba(255,110,25,' + (0.22 + eruptPulse * 0.3) + ')');
      lg.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 2.4 + eruptPulse * 3.5;
      ctx.beginPath();
      ctx.moveTo(g.ts * 0.4, 0);
      ctx.quadraticCurveTo(len * 0.5, g.ts * 0.5 * Math.sin(t + k), len, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // shockwave when it breathes out
    if (eruptPulse > 0) {
      var ea = 1 - eruptPulse;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = eruptPulse * 0.7;
      ctx.strokeStyle = '#ff8a3d';
      ctx.lineWidth = 3 + eruptPulse * 5;
      ctx.beginPath();
      ctx.arc(cxp, cyp, g.ts * (1 + ea * 11), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function ownerOf(cell, push) {
    var s = Math.cos(cell.ang);
    return s + push * 0.75 > 0 ? 2 : 1;
  }

  function drawRing(t, g, push, eruptPulse, cxp, cyp) {
    var ts = g.ts;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#0a0910';
    cells.forEach(function (c) { ctx.fillRect(g.ox + c.x * ts, g.oy + c.y * ts, ts, ts); });
    ctx.restore();

    cells.forEach(function (c) {
      var X = g.ox + c.x * ts, Y = g.oy + c.y * ts;
      var own = ownerOf(c, push);
      var col = own === 1 ? '#ffd15c' : '#ef6f57';
      var deep = own === 1 ? '#7d5310' : '#7a2f25';
      var base = c.elev >= 3 ? 92 : c.elev === 2 ? 70 : 52;
      var j = (c.seed - .5) * 14;
      ctx.fillStyle = 'rgb(' + Math.round(base + j) + ',' + Math.round(base - 8 + j) + ',' + Math.round(base + 6 + j) + ')';
      ctx.fillRect(X, Y, ts, ts);
      var lg = ctx.createLinearGradient(X, Y, X, Y + ts);
      lg.addColorStop(0, 'rgba(255,255,255,' + (0.02 + c.elev * 0.03) + ')');
      lg.addColorStop(1, 'rgba(0,0,0,0.32)');
      ctx.fillStyle = lg; ctx.fillRect(X, Y, ts, ts);
      if (c.fert > 0) {
        ctx.save(); ctx.globalAlpha = 0.10 + c.fert * 0.07;
        ctx.fillStyle = '#7fe0a8'; ctx.fillRect(X, Y, ts, ts); ctx.restore();
      }
      var og = ctx.createLinearGradient(X, Y, X + ts, Y + ts);
      og.addColorStop(0, hexA(col, 0.36)); og.addColorStop(1, hexA(deep, 0.44));
      ctx.fillStyle = og; ctx.fillRect(X, Y, ts, ts);
      if (eruptPulse > 0) {
        var d = Math.hypot(X + ts / 2 - cxp, Y + ts / 2 - cyp) / ts;
        var front = (1 - eruptPulse) * 11;
        var near = Math.max(0, 1 - Math.abs(d - front) / 2.2);
        if (near > 0) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = near * eruptPulse * 0.85;
          ctx.fillStyle = '#ff9a3a'; ctx.fillRect(X, Y, ts, ts); ctx.restore();
        }
      }
    });

    var owners = {};
    cells.forEach(function (c) { owners[c.x + ',' + c.y] = ownerOf(c, push); });
    ctx.save(); ctx.lineCap = 'round';
    cells.forEach(function (c) {
      var own = owners[c.x + ',' + c.y];
      var col = own === 1 ? '#ffd15c' : '#ef6f57';
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.lineWidth = 2.2;
      var X = g.ox + c.x * ts, Y = g.oy + c.y * ts;
      [[c.x - 1, c.y, X, Y, X, Y + ts], [c.x + 1, c.y, X + ts, Y, X + ts, Y + ts],
       [c.x, c.y - 1, X, Y, X + ts, Y], [c.x, c.y + 1, X, Y + ts, X + ts, Y + ts]].forEach(function (s) {
        if (owners[s[0] + ',' + s[1]] === own) return;
        ctx.beginPath(); ctx.moveTo(s[2], s[3]); ctx.lineTo(s[4], s[5]); ctx.stroke();
      });
    });
    ctx.restore();

    var bc = beaconCell();
    if (bc) {
      var bx = g.ox + bc.x * ts + ts / 2, by = g.oy + bc.y * ts + ts / 2;
      var p = 0.5 + 0.5 * Math.sin(t * 2.2);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var bg = ctx.createRadialGradient(bx, by, 0, bx, by, ts * (2.2 + p * 0.6));
      bg.addColorStop(0, 'rgba(255,225,150,' + (0.5 + p * 0.2) + ')');
      bg.addColorStop(0.4, 'rgba(255,170,60,0.15)'); bg.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = bg; ctx.fillRect(bx - ts * 3, by - ts * 3, ts * 6, ts * 6); ctx.restore();
      ctx.save(); ctx.translate(bx, by); ctx.shadowColor = '#ffd15c'; ctx.shadowBlur = 18;
      ctx.beginPath();
      var R = ts * 0.42, r2 = R * 0.42;
      for (var v = 0; v < 10; v++) {
        var a = v / 10 * Math.PI * 2 - Math.PI / 2, rad = v % 2 === 0 ? R : r2;
        var px = Math.cos(a) * rad, py = Math.sin(a) * rad;
        if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      sg.addColorStop(0, '#fffbe8'); sg.addColorStop(0.55, '#ffd15c'); sg.addColorStop(1, '#ff8a2a');
      ctx.fillStyle = sg; ctx.fill(); ctx.restore();
    }
  }

  var _beacon = null;
  function beaconCell() {
    if (_beacon) return _beacon;
    var best = null, bs = 1e9, cx = (GW - 1) / 2;
    cells.forEach(function (c) {
      var s = c.y * 3 + Math.abs(c.x - cx);
      if (s < bs) { bs = s; best = c; }
    });
    _beacon = best;
    return best;
  }

  function routeCells(lane) {
    return cells.filter(function (c) { return c.lane === lane && c.x >= 4 && c.x <= 25; })
      .sort(function (a, b) { return a.x - b.x || a.y - b.y; });
  }

  function cellCentre(c, g) {
    return { x: g.ox + (c.x + 0.5) * g.ts, y: g.oy + (c.y + 0.5) * g.ts };
  }

  function drawFront(c, g, colour, alpha) {
    if (!c) return;
    var p = cellCentre(c, g), R = g.ts * 1.55;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    glow.addColorStop(0, hexA(colour, alpha));
    glow.addColorStop(0.42, hexA(colour, alpha * 0.30));
    glow.addColorStop(1, hexA(colour, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
    ctx.strokeStyle = hexA(colour, alpha * 0.95);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(p.x - g.ts * .34, p.y - g.ts * .34, g.ts * .68, g.ts * .68);
    ctx.restore();
  }

  function drawBeacon(c, g, t) {
    if (!c) return;
    var p = cellCentre(c, g), pulse = .5 + .5 * Math.sin(t * 2.2), R = g.ts * .42;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = '#ffd15c'; ctx.shadowBlur = 16;
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    for (var v = 0; v < 10; v++) {
      var a = v / 10 * Math.PI * 2 - Math.PI / 2;
      var rad = v % 2 === 0 ? R * (1 + pulse * .12) : R * .42;
      var px = Math.cos(a) * rad, py = Math.sin(a) * rad;
      if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var star = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    star.addColorStop(0, '#fffbe8'); star.addColorStop(.55, '#ffd15c'); star.addColorStop(1, '#ff8a2a');
    ctx.fillStyle = star; ctx.fill();
    ctx.restore();
  }

  function drawRouteBeds(g, t) {
    var ts = g.ts;
    function point(x, y) { return { x: g.ox + (x + .5) * ts, y: g.oy + (y + .5) * ts }; }
    function ribbon(lane, colour) {
      var y = lane === 'north' ? 3.5 : 13.5;
      var a = point(2.5, 8.5), b = point(4, y), c = point(25, y), d = point(27.5, 8.5);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = colour; ctx.lineWidth = ts * 2.9;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(b.x, b.y, point(9, y).x, point(9, y).y);
      ctx.lineTo(point(21, y).x, point(21, y).y);
      ctx.quadraticCurveTo(c.x, c.y, d.x, d.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(180,217,227,.12)'; ctx.lineWidth = ts * .16;
      ctx.setLineDash([ts * .35, ts * .48]); ctx.lineDashOffset = -t * 8;
      ctx.stroke();
      ctx.restore();
    }
    ribbon('north', 'rgba(71,135,165,.20)');
    ribbon('south', 'rgba(86,146,129,.19)');
  }

  function drawTopology(t, g, eruptPulse, cxp, cyp, sceneDrive) {
    var ts = g.ts;
    // The wide terrain beds make the two-front silhouette immediately legible
    // at homepage scale; the smaller squares are texture rather than a second
    // instructional map.
    drawRouteBeds(g, t);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#070b11';
    cells.forEach(function (c) { ctx.fillRect(g.ox + c.x * ts, g.oy + c.y * ts, ts, ts); });
    ctx.restore();

    cells.forEach(function (c) {
      var X = g.ox + c.x * ts, Y = g.oy + c.y * ts;
      var j = (c.seed - .5) * 12;
      var base = c.kind === 'fan' ? [56, 83, 96] : c.lane === 'north' ? [45, 94, 116] : [57, 101, 94];
      var tone = c.elev >= 3 ? 12 : c.elev === 1 ? -7 : 0;
      ctx.fillStyle = 'rgb(' + Math.round(base[0] + j + tone) + ',' + Math.round(base[1] + j + tone) + ',' + Math.round(base[2] + j + tone) + ')';
      ctx.fillRect(X, Y, ts, ts);
      var shade = ctx.createLinearGradient(X, Y, X, Y + ts);
      shade.addColorStop(0, 'rgba(222,244,255,' + (.035 + c.fert * .02) + ')');
      shade.addColorStop(1, 'rgba(0,0,0,.34)');
      ctx.fillStyle = shade; ctx.fillRect(X, Y, ts, ts);
      ctx.strokeStyle = 'rgba(192,224,233,.25)'; ctx.lineWidth = .9;
      ctx.strokeRect(X + .4, Y + .4, ts - .8, ts - .8);

      if (eruptPulse > 0) {
        var d = Math.hypot(X + ts / 2 - cxp, Y + ts / 2 - cyp) / ts;
        var front = (1 - eruptPulse) * 11;
        var near = Math.max(0, 1 - Math.abs(d - front) / 2.2);
        if (near > 0) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = near * eruptPulse * .58;
          ctx.fillStyle = '#ff9a3a'; ctx.fillRect(X, Y, ts, ts); ctx.restore();
        }
      }
    });

    // A pair of small travelling fronts imply opposition without splitting
    // the entire field into two loud team-colour blocks.
    var active = (Math.floor(t / 7) + (scene >= 3 ? 1 : 0)) % 2 ? 'south' : 'north';
    ['north', 'south'].forEach(function (lane, laneIndex) {
      var path = routeCells(lane);
      var row = lane === 'north' ? 3 : 13;
      var core = path.filter(function (c) { return c.x >= 5 && c.x <= 24 && c.y === row; });
      var travel = .13 + (.5 + .5 * Math.sin(t * .31 + laneIndex * 1.7)) * .29;
      var intensity = lane === active ? 1 : .46;
      var left = core[Math.floor((core.length - 1) * travel)];
      var right = core[Math.max(0, core.length - 1 - Math.floor((core.length - 1) * travel))];
      drawFront(left, g, '#a8d8e5', .74 * intensity * sceneDrive);
      drawFront(right, g, '#ef947f', .62 * intensity * sceneDrive);

      [9, 20].forEach(function (x) {
        path.filter(function (c) { return c.x === x; }).forEach(function (c) {
          var p = cellCentre(c, g);
          ctx.save(); ctx.strokeStyle = 'rgba(255,213,122,' + (.34 + intensity * .24) + ')'; ctx.lineWidth = 1.35;
          ctx.strokeRect(p.x - ts * .31, p.y - ts * .31, ts * .62, ts * .62); ctx.restore();
        });
      });

      var beacon = path.filter(function (c) { return c.x === 15 && c.y === row; })[0];
      if (lane === active) drawBeacon(beacon, g, t);
    });

    // A faint moving contour around the caldera carries the idea that the
    // field is being reorganised, without looking like a third playable lane.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,157,72,.22)'; ctx.lineWidth = 1.4;
    ctx.setLineDash([ts * .32, ts * .6]); ctx.lineDashOffset = t * 11;
    ctx.beginPath(); ctx.ellipse(cxp, cyp, ts * 5.2, ts * 3.3, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Sparks now occur around the current pressure points rather than a fixed
  // ownership seam, so the background reads as a living contest.
  function drawTopologySparks(t, g, sceneDrive) {
    var ts = g.ts;
    var active = (Math.floor(t / 7) + (scene >= 3 ? 1 : 0)) % 2 ? 'south' : 'north';
    var candidates = routeCells(active).filter(function (c) { return c.x >= 10 && c.x <= 20; });
    if (candidates.length && Math.random() < .42 * sceneDrive) {
      var c = candidates[Math.floor(Math.random() * candidates.length)];
      var p = cellCentre(c, g);
      for (var k = 0; k < 5; k++) {
        var a = Math.random() * Math.PI * 2, v = .4 + Math.random() * 1.45;
        sparks.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - .4,
          life: 1, decay: .022 + Math.random() * .03, size: 1 + Math.random() * 1.8,
          color: Math.random() < .5 ? '#fff2c8' : (Math.random() < .5 ? '#a8d8e5' : '#ffae66') });
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = sparks.length - 1; i >= 0; i--) {
      var p = sparks[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.life -= p.decay;
      if (p.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.restore();
    if (sparks.length > 500) sparks.splice(0, sparks.length - 500);
  }

  function drawSparks(t, g, push) {
    var ts = g.ts;
    var seam = cells.filter(function (c) {
      var own = ownerOf(c, push);
      return cells.some(function (o) {
        return Math.abs(o.x - c.x) + Math.abs(o.y - c.y) === 1 && ownerOf(o, push) !== own;
      });
    });
    if (seam.length && Math.random() < 0.55) {
      var c = seam[Math.floor(Math.random() * seam.length)];
      var X = g.ox + c.x * ts + ts / 2, Y = g.oy + c.y * ts + ts / 2;
      for (var k = 0; k < 7; k++) {
        var a = Math.random() * Math.PI * 2, v = 0.4 + Math.random() * 1.6;
        sparks.push({ x: X, y: Y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.4,
          life: 1, decay: 0.02 + Math.random() * 0.03, size: 1 + Math.random() * 2,
          color: Math.random() < .5 ? '#fff2c8' : (Math.random() < .5 ? '#ffd15c' : '#ef6f57') });
      }
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = sparks.length - 1; i >= 0; i--) {
      var p = sparks[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.life -= p.decay;
      if (p.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.restore();
    if (sparks.length > 500) sparks.splice(0, sparks.length - 500);
  }

  function drawAsh(t) {
    if (ash.length < 130 && Math.random() < 0.9) {
      ash.push({ x: Math.random() * w, y: -8, vx: -0.2 + Math.random() * 0.4,
        vy: 0.25 + Math.random() * 0.55, size: 0.8 + Math.random() * 1.8,
        a: 0.15 + Math.random() * 0.4 });
    }
    ctx.save();
    for (var i = ash.length - 1; i >= 0; i--) {
      var p = ash[i];
      p.x += p.vx + Math.sin(p.y * 0.02) * 0.3;
      p.y += p.vy;
      if (p.y > h + 10) { ash.splice(i, 1); continue; }
      ctx.globalAlpha = p.a;
      ctx.fillStyle = '#b9adb5';
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.restore();
  }

  function drawVignette() {
    var g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function hexA(hex, a) {
    var n = parseInt(hex.replace('#', ''), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function setScene(next) {
    next = Math.max(0, Math.min(5, Number(next) || 0));
    if (next === scene) return;
    scene = next;
    // The final lesson is about Cinder. Give that page an immediate, purely
    // visual breath instead of making the player wait for the ambient cycle.
    if (scene === 5) {
      erupt = sceneTime;
      nextErupt = sceneTime + 8;
    }
  }

  return { init: init, start: start, stop: stop, resize: resize, setScene: setScene };
})();
