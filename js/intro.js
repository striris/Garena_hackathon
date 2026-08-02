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
        // The ring has to read as an atoll: open sea outside it, and a wide
        // dark caldera inside where the mountain shows through. Normalising
        // to a third of the grid leaves margin on both.
        var dx = (x - cx) / (GW * 0.365), dy = (y - cy) / (GH * 0.365);
        var r = Math.sqrt(dx * dx + dy * dy);
        var n = (U.hash32(x * 6151 + y * 13093) - 0.5) * 0.17;
        if (Math.abs(r - 1) + n > 0.21) continue;
        var ang = Math.atan2(y - cy, x - cx);          // -PI..PI
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
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    var g = geom();
    var cxp = g.ox + g.ts * GW / 2;
    var cyp = g.oy + g.ts * GH / 2;

    // the border between the two peoples grinds back and forth: neither
    // of them is winning, which is exactly the problem
    var push = Math.sin(t * 0.42) * 0.30 + Math.sin(t * 0.17 + 1.3) * 0.16;

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
    // west is Ashfarers, east is Saltkin; the seam is where |angle| is
    // near a right angle, and it slides with `push`
    var s = Math.cos(cell.ang);           // +1 east, -1 west
    return s + push * 0.75 > 0 ? 2 : 1;
  }

  function drawRing(t, g, push, eruptPulse, cxp, cyp) {
    var ts = g.ts;

    // land shadow, one pass, so the ring reads as a single body
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#0a0910';
    cells.forEach(function (c) {
      ctx.fillRect(g.ox + c.x * ts, g.oy + c.y * ts, ts, ts);
    });
    ctx.restore();

    cells.forEach(function (c) {
      var X = g.ox + c.x * ts, Y = g.oy + c.y * ts;
      var own = ownerOf(c, push);
      var col = own === 1 ? '#3ddc84' : '#ff8a3d';
      var deep = own === 1 ? '#0f6b45' : '#7a3410';

      // rock
      var base = c.elev >= 3 ? 92 : c.elev === 2 ? 70 : 52;
      var j = (c.seed - .5) * 14;
      ctx.fillStyle = 'rgb(' + Math.round(base + j) + ',' + Math.round(base - 8 + j) + ',' + Math.round(base + 6 + j) + ')';
      ctx.fillRect(X, Y, ts, ts);

      var lg = ctx.createLinearGradient(X, Y, X, Y + ts);
      lg.addColorStop(0, 'rgba(255,255,255,' + (0.02 + c.elev * 0.03) + ')');
      lg.addColorStop(1, 'rgba(0,0,0,0.32)');
      ctx.fillStyle = lg;
      ctx.fillRect(X, Y, ts, ts);

      // soil
      if (c.fert > 0) {
        ctx.save();
        ctx.globalAlpha = 0.10 + c.fert * 0.07;
        ctx.fillStyle = '#7fe0a8';
        ctx.fillRect(X, Y, ts, ts);
        ctx.restore();
      }

      // ownership
      var og = ctx.createLinearGradient(X, Y, X + ts, Y + ts);
      og.addColorStop(0, hexA(col, 0.36));
      og.addColorStop(1, hexA(deep, 0.44));
      ctx.fillStyle = og;
      ctx.fillRect(X, Y, ts, ts);

      // the eruption washes over everything for a moment
      if (eruptPulse > 0) {
        var d = Math.hypot(X + ts / 2 - cxp, Y + ts / 2 - cyp) / ts;
        var front = (1 - eruptPulse) * 11;
        var near = Math.max(0, 1 - Math.abs(d - front) / 2.2);
        if (near > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = near * eruptPulse * 0.85;
          ctx.fillStyle = '#ff9a3a';
          ctx.fillRect(X, Y, ts, ts);
          ctx.restore();
        }
      }
    });

    // territory outlines
    var owners = {};
    cells.forEach(function (c) { owners[c.x + ',' + c.y] = ownerOf(c, push); });
    ctx.save();
    ctx.lineCap = 'round';
    cells.forEach(function (c) {
      var own = owners[c.x + ',' + c.y];
      var col = own === 1 ? '#3ddc84' : '#ff8a3d';
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.lineWidth = 2.2;
      var X = g.ox + c.x * ts, Y = g.oy + c.y * ts;
      var sides = [
        [c.x - 1, c.y, X, Y, X, Y + ts],
        [c.x + 1, c.y, X + ts, Y, X + ts, Y + ts],
        [c.x, c.y - 1, X, Y, X + ts, Y],
        [c.x, c.y + 1, X, Y + ts, X + ts, Y + ts]
      ];
      sides.forEach(function (s) {
        if (owners[s[0] + ',' + s[1]] === own) return;
        ctx.beginPath(); ctx.moveTo(s[2], s[3]); ctx.lineTo(s[4], s[5]); ctx.stroke();
      });
    });
    ctx.restore();

    // the Beacon, sitting on the northern arc
    var bc = beaconCell();
    if (bc) {
      var bx = g.ox + bc.x * ts + ts / 2, by = g.oy + bc.y * ts + ts / 2;
      var p = 0.5 + 0.5 * Math.sin(t * 2.2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var bg = ctx.createRadialGradient(bx, by, 0, bx, by, ts * (2.2 + p * 0.6));
      bg.addColorStop(0, 'rgba(255,225,150,' + (0.5 + p * 0.2) + ')');
      bg.addColorStop(0.4, 'rgba(255,170,60,0.15)');
      bg.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(bx - ts * 3, by - ts * 3, ts * 6, ts * 6);
      ctx.restore();

      ctx.save();
      ctx.translate(bx, by);
      ctx.shadowColor = '#ffd15c'; ctx.shadowBlur = 18;
      ctx.beginPath();
      var R = ts * 0.42, r2 = R * 0.42;
      for (var v = 0; v < 10; v++) {
        var a = v / 10 * Math.PI * 2 - Math.PI / 2;
        var rad = v % 2 === 0 ? R : r2;
        var px = Math.cos(a) * rad, py = Math.sin(a) * rad;
        if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      sg.addColorStop(0, '#fffbe8'); sg.addColorStop(0.55, '#ffd15c'); sg.addColorStop(1, '#ff8a2a');
      ctx.fillStyle = sg; ctx.fill();
      ctx.restore();
    }
  }

  var _beacon = null;
  function beaconCell() {
    if (_beacon) return _beacon;
    // topmost cell nearest the vertical centreline
    var best = null, bs = 1e9;
    var cx = (GW - 1) / 2;
    cells.forEach(function (c) {
      var s = c.y * 3 + Math.abs(c.x - cx);
      if (s < bs) { bs = s; best = c; }
    });
    _beacon = best;
    return best;
  }

  // fighting along the seam: sparks where jade meets orange
  function drawSparks(t, g, push) {
    var ts = g.ts;
    var seam = cells.filter(function (c) {
      var own = ownerOf(c, push);
      var n = cells.filter(function (o) {
        return Math.abs(o.x - c.x) + Math.abs(o.y - c.y) === 1 && ownerOf(o, push) !== own;
      });
      return n.length > 0;
    });

    if (seam.length && Math.random() < 0.55) {
      var c = seam[Math.floor(Math.random() * seam.length)];
      var X = g.ox + c.x * ts + ts / 2, Y = g.oy + c.y * ts + ts / 2;
      for (var k = 0; k < 7; k++) {
        var a = Math.random() * Math.PI * 2, v = 0.4 + Math.random() * 1.6;
        sparks.push({ x: X, y: Y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.4,
          life: 1, decay: 0.02 + Math.random() * 0.03, size: 1 + Math.random() * 2,
          color: Math.random() < .5 ? '#fff2c8' : (Math.random() < .5 ? '#3ddc84' : '#ff8a3d') });
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

  return { init: init, start: start, stop: stop, resize: resize };
})();
