/* ============================================================
   render.js — the war table
   No characters, no animation rigs, no voice acting. This is a map
   you read. So everything dramatic has to happen to the map itself:
   the sea moves, the coast glows, the crater breathes, and when the
   mountain acts the whole table shakes.
   ============================================================ */
CF.render = (function () {
  var U = CF.util, E = CF.engine, EV = CF.events;

  var cv, ctx, dpr = 1;
  var state = null;
  var geom = { ts: 40, ox: 0, oy: 0, w: 0, h: 0 };

  var particles = [];
  var rings = [];
  var flashes = {};      // tileIdx -> { until, color }
  var shake = 0, shakeT = 0;
  var t0 = performance.now();
  var hover = -1;
  var previewOrders = [];
  var rifts = [];

  var COL = {
    jade: '#3ddc84', jadeDeep: '#0f6b45',
    molten: '#ff8a3d', moltenDeep: '#7a3410',
    violet: '#b39ddb',
    beacon: '#ffd15c', fire: '#ff4a1c'
  };

  function sideColor(o) {
    return o === 1 ? COL.jade : o === 2 ? COL.molten : o === 3 ? COL.violet : '#8d8298';
  }
  function sideDeep(o) {
    return o === 1 ? COL.jadeDeep : o === 2 ? COL.moltenDeep : o === 3 ? '#4b3a68' : '#3a3446';
  }

  // ------------------------------------------------------------------ init
  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(loop);
  }

  function resize() {
    if (!cv) return;
    var r = cv.parentNode.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.floor(r.width * dpr);
    cv.height = Math.floor(r.height * dpr);
    geom.w = r.width; geom.h = r.height;
    layout();
  }

  function layout() {
    if (!state) return;
    var pad = 16;
    var ts = Math.floor(Math.min((geom.w - pad * 2) / state.W, (geom.h - pad * 2) / state.H));
    geom.ts = ts;
    geom.ox = (geom.w - ts * state.W) / 2;
    geom.oy = (geom.h - ts * state.H) / 2;
  }

  function setState(s) { state = s; layout(); }
  function setHover(i) { hover = i; }
  function setPreview(list) { previewOrders = list || []; }

  function tileAt(px, py) {
    if (!state) return -1;
    var x = Math.floor((px - geom.ox) / geom.ts);
    var y = Math.floor((py - geom.oy) / geom.ts);
    if (x < 0 || y < 0 || x >= state.W || y >= state.H) return -1;
    return y * state.W + x;
  }

  function tileRect(i) {
    var x = i % state.W, y = (i / state.W) | 0;
    return { x: geom.ox + x * geom.ts, y: geom.oy + y * geom.ts, s: geom.ts };
  }
  function tileCentre(i) {
    var r = tileRect(i);
    return { x: r.x + r.s / 2, y: r.y + r.s / 2 };
  }

  // ------------------------------------------------------------------- fx
  function push(fx) {
    if (!fx || !state) return;
    fx.forEach(function (f) {
      switch (f.kind) {
        case 'capture':
          flash(f.at, sideColor(f.side), 700);
          burst(f.at, sideColor(f.side), 26, 2.6);
          ring(f.at, sideColor(f.side), 1.8, 520);
          if (f.from != null) tracer(f.from, f.at, sideColor(f.side));
          break;
        case 'repel':
          flash(f.at, '#ffffff', 260);
          burst(f.at, '#c8c0d8', 10, 1.2);
          if (f.from != null) tracer(f.from, f.at, '#b8adc8');
          break;
        case 'settle':
          flash(f.at, sideColor(f.side), 520);
          ring(f.at, sideColor(f.side), 1.2, 430);
          break;
        case 'settle3':
          flash(f.at, COL.violet, 700);
          burst(f.at, COL.violet, 16, 1.6);
          break;
        case 'clash':
          flash(f.at, '#ffffff', 420); burst(f.at, '#ffffff', 14, 1.6); break;
        case 'fortify':
          burst(f.at, '#7fd0ff', 10, 1.0, -1.6); break;
        case 'starve':
          burst(f.at, '#6c6480', 14, 1.1); break;
        case 'beaconTick':
          ring(f.at, COL.beacon, 2.2, 800); break;
        case 'sink':
          flash(f.at, '#1a4a72', 600);
          burst(f.at, '#7fc7ff', 22, 2.2, -1.0);
          ring(f.at, '#4aa8e8', 1.5, 620);
          break;
        case 'rise':
          flash(f.at, COL.fire, 900);
          burst(f.at, COL.beacon, 26, 2.6, -2.2);
          ring(f.at, COL.molten, 2.0, 760);
          break;
        case 'bless':
          burst(f.at, COL.jade, 12, 1.3, -1.4); break;
        case 'quake':
          shake = Math.max(shake, f.power * 5); shakeT = performance.now(); break;
        case 'shock':
          ring(f.at, COL.fire, f.r || 2, 1100, true);
          lavaBurst(f.at, f.r || 2);
          break;
        case 'rift':
          rifts.push({ line: f.line, dir: f.dir, region: f.region, born: performance.now() }); break;
        case 'flood':
          floodSweep(f.region); break;
        case 'skyDark':
          for (var i = 0; i < 90; i++) ashFleck(); break;
        case 'cool':
          for (var j = 0; j < 40; j++) ashFleck('#9fb7c9'); break;
        case 'storm':
          for (var k = 0; k < 60; k++) ashFleck('#8fd0ff'); break;
        case 'beaconMove':
          if (f.from != null) { burst(f.from, COL.beacon, 24, 2.4); ring(f.from, COL.beacon, 2, 700); }
          ring(f.to, COL.beacon, 3.2, 1200, true);
          burst(f.to, COL.beacon, 40, 3.0, -1.5);
          flash(f.to, COL.beacon, 1200);
          break;
      }
    });
  }

  function flash(i, color, ms) { flashes[i] = { until: performance.now() + ms, color: color, ms: ms }; }

  function ring(i, color, r, ms, thick) {
    var c = tileCentre(i);
    rings.push({ x: c.x, y: c.y, r0: geom.ts * 0.25, r1: geom.ts * r, born: performance.now(), ms: ms, color: color, thick: thick ? 5 : 2.2 });
  }

  function burst(i, color, n, speed, biasY) {
    var c = tileCentre(i);
    for (var k = 0; k < n; k++) {
      var a = Math.random() * Math.PI * 2;
      var v = (0.4 + Math.random()) * speed;
      particles.push({
        x: c.x, y: c.y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v + (biasY || 0),
        g: 0.04, life: 1, decay: 0.014 + Math.random() * 0.02,
        size: 1 + Math.random() * 2.4, color: color
      });
    }
  }

  function tracer(from, to, color) {
    var a = tileCentre(from), b = tileCentre(to);
    for (var k = 0; k < 12; k++) {
      var t = k / 12;
      particles.push({
        x: U.lerp(a.x, b.x, t), y: U.lerp(a.y, b.y, t),
        vx: (b.x - a.x) * 0.012, vy: (b.y - a.y) * 0.012,
        g: 0, life: 1, decay: 0.05, size: 1.6, color: color
      });
    }
  }

  function lavaBurst(i, r) {
    var c = tileCentre(i);
    for (var k = 0; k < 70; k++) {
      var a = Math.random() * Math.PI * 2;
      var v = (0.5 + Math.random() * 1.6) * r;
      particles.push({
        x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.4,
        g: 0.075, life: 1, decay: 0.009 + Math.random() * 0.012,
        size: 1.4 + Math.random() * 3.2,
        color: Math.random() < .45 ? COL.beacon : Math.random() < .6 ? COL.fire : '#ff9a4a'
      });
    }
  }

  function ashFleck(color) {
    particles.push({
      x: Math.random() * geom.w, y: -10 - Math.random() * geom.h,
      vx: -0.25 + Math.random() * 0.5, vy: 0.35 + Math.random() * 0.7,
      g: 0, life: 1, decay: 0.0016, size: 0.8 + Math.random() * 1.7,
      color: color || '#9a8f9f', drift: true
    });
  }

  function floodSweep(region) {
    for (var i = 0; i < state.tiles.length; i++) {
      if (!CF.events.inRegion(state, i, region)) continue;
      if (Math.random() < 0.5) burst(i, '#6fc2ff', 4, 1.0, -0.6);
    }
  }

  // ------------------------------------------------------------ main loop
  function loop(now) {
    requestAnimationFrame(loop);
    if (!state || !ctx) return;
    draw(now);
  }

  function draw(now) {
    var t = (now - t0) / 1000;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, geom.w, geom.h);

    // screen shake decays over ~700ms
    if (shake > 0.05) {
      var age = (now - shakeT) / 700;
      var amp = shake * Math.max(0, 1 - age);
      if (age >= 1) shake = 0;
      ctx.translate(Math.sin(now * 0.07) * amp, Math.cos(now * 0.093) * amp);
    }

    drawOcean(t);
    drawLandMass(t);
    drawTiles(t, now);
    drawTerritoryEdges();
    drawRifts(now);
    drawBeacon(t);
    drawOrders(t);
    drawHover();
    drawRings(now);
    drawParticles();
    drawWeather(t);

    ctx.restore();
  }

  // --------------------------------------------------------------- ocean
  function drawOcean(t) {
    var g = ctx.createLinearGradient(0, 0, geom.w, geom.h);
    g.addColorStop(0, '#05121f');
    g.addColorStop(0.45, '#0a2338');
    g.addColorStop(1, '#061726');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, geom.w, geom.h);

    // the mountain glowing under the caldera
    var cxp = geom.ox + geom.ts * state.W / 2;
    var cyp = geom.oy + geom.ts * state.H / 2;
    var pulse = 0.5 + 0.5 * Math.sin(t * 0.8);
    var rg = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, geom.ts * 3.6);
    rg.addColorStop(0, 'rgba(255,90,20,' + (0.16 + pulse * 0.12) + ')');
    rg.addColorStop(0.5, 'rgba(255,60,10,0.05)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, geom.w, geom.h);

    // swell
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < 5; k++) {
      ctx.beginPath();
      var yb = geom.h * (k + 0.5) / 5;
      for (var x = 0; x <= geom.w; x += 8) {
        var y = yb + Math.sin(x * 0.016 + t * (0.5 + k * 0.12) + k) * (7 + k * 2)
                   + Math.sin(x * 0.041 - t * 0.7) * 3;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(90,180,235,0.045)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();

    // faint lattice so you can read where new land could rise
    ctx.strokeStyle = 'rgba(140,190,220,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i <= state.W; i++) {
      ctx.moveTo(geom.ox + i * geom.ts, geom.oy);
      ctx.lineTo(geom.ox + i * geom.ts, geom.oy + state.H * geom.ts);
    }
    for (var j = 0; j <= state.H; j++) {
      ctx.moveTo(geom.ox, geom.oy + j * geom.ts);
      ctx.lineTo(geom.ox + state.W * geom.ts, geom.oy + j * geom.ts);
    }
    ctx.stroke();
  }

  // shadow + surf under every landmass, drawn as one pass so the coast
  // reads as a single shape rather than 140 separate squares
  function drawLandMass(t) {
    var ts = geom.ts;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#0b0a10';
    for (var i = 0; i < state.tiles.length; i++) {
      if (!state.tiles[i].land) continue;
      var r = tileRect(i);
      ctx.fillRect(r.x, r.y, ts, ts);
    }
    ctx.restore();

    // surf line: brighter where land meets water
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var surf = 0.09 + 0.05 * Math.sin(t * 1.6);
    ctx.strokeStyle = 'rgba(150,220,255,' + surf + ')';
    ctx.lineWidth = 3;
    for (var j = 0; j < state.tiles.length; j++) {
      if (!state.tiles[j].land) continue;
      edgesOf(j, function (nb) { return !nb || !nb.land; }, function (x1, y1, x2, y2) {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });
    }
    ctx.restore();
  }

  // walk the four edges of a tile, calling back for those where test() passes
  function edgesOf(i, test, cb) {
    var W = state.W, H = state.H, x = i % W, y = (i / W) | 0;
    var r = tileRect(i), s = geom.ts;
    var sides = [
      [x > 0 ? i - 1 : null, r.x, r.y, r.x, r.y + s],
      [x < W - 1 ? i + 1 : null, r.x + s, r.y, r.x + s, r.y + s],
      [y > 0 ? i - W : null, r.x, r.y, r.x + s, r.y],
      [y < H - 1 ? i + W : null, r.x, r.y + s, r.x + s, r.y + s]
    ];
    for (var k = 0; k < 4; k++) {
      var nb = sides[k][0] == null ? null : state.tiles[sides[k][0]];
      if (test(nb)) cb(sides[k][1], sides[k][2], sides[k][3], sides[k][4]);
    }
  }

  // --------------------------------------------------------------- tiles
  function drawTiles(t, now) {
    var ts = geom.ts;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < state.tiles.length; i++) {
      var tile = state.tiles[i];
      if (!tile.land) continue;
      var r = tileRect(i);
      var n = U.hash32(i * 7717 + state.seed);

      // --- rock, shaded by height ------------------------------------
      var base = tile.elev >= 3 ? [92, 84, 96] : tile.elev === 2 ? [70, 62, 70] : [52, 47, 55];
      var jitter = (n - 0.5) * 14;
      ctx.fillStyle = 'rgb(' + Math.round(base[0] + jitter) + ',' + Math.round(base[1] + jitter) + ',' + Math.round(base[2] + jitter) + ')';
      ctx.fillRect(r.x, r.y, ts, ts);

      // top-light so height reads at a glance
      var lg = ctx.createLinearGradient(r.x, r.y, r.x, r.y + ts);
      lg.addColorStop(0, 'rgba(255,255,255,' + (0.02 + tile.elev * 0.032) + ')');
      lg.addColorStop(1, 'rgba(0,0,0,0.30)');
      ctx.fillStyle = lg;
      ctx.fillRect(r.x, r.y, ts, ts);

      // --- soil ------------------------------------------------------
      if (tile.fert > 0) {
        ctx.save();
        ctx.globalAlpha = 0.10 + tile.fert * 0.075;
        ctx.fillStyle = tile.crater ? '#ffb457' : '#7fe0a8';
        ctx.fillRect(r.x, r.y, ts, ts);
        ctx.restore();
        // speckle: one cluster per point of fertility
        ctx.fillStyle = tile.crater ? 'rgba(255,190,110,0.55)' : 'rgba(160,240,190,0.42)';
        for (var f = 0; f < tile.fert * 3; f++) {
          var hx = U.hash32(i * 131 + f * 977 + 5) * (ts - 8) + 4;
          var hy = U.hash32(i * 977 + f * 131 + 9) * (ts - 8) + 4;
          ctx.fillRect(r.x + hx, r.y + hy, 1.6, 1.6);
        }
      }

      // --- crater: still cooling -------------------------------------
      if (tile.crater) {
        var glow = 0.18 + 0.14 * Math.sin(t * 2.4 + i);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var cg = ctx.createRadialGradient(r.x + ts / 2, r.y + ts / 2, 0, r.x + ts / 2, r.y + ts / 2, ts * 0.7);
        cg.addColorStop(0, 'rgba(255,120,30,' + glow + ')');
        cg.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(r.x - 4, r.y - 4, ts + 8, ts + 8);
        ctx.restore();
        if (Math.random() < 0.03) {
          particles.push({ x: r.x + Math.random() * ts, y: r.y + ts * 0.7,
            vx: (Math.random() - .5) * 0.3, vy: -0.4 - Math.random() * 0.5,
            g: 0, life: 1, decay: 0.012, size: 1.2, color: COL.beacon });
        }
      }

      // --- ownership --------------------------------------------------
      var owned = tile.owner !== 0;
      if (owned) {
        var col = sideColor(tile.owner), deep = sideDeep(tile.owner);
        var og = ctx.createLinearGradient(r.x, r.y, r.x + ts, r.y + ts);
        og.addColorStop(0, hexA(col, 0.34));
        og.addColorStop(1, hexA(deep, 0.42));
        ctx.fillStyle = og;
        ctx.fillRect(r.x, r.y, ts, ts);

        // inner rim
        ctx.strokeStyle = hexA(col, 0.28);
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 1.5, r.y + 1.5, ts - 3, ts - 3);

        // --- cut off from home ---------------------------------------
        if (state.supply[i] !== tile.owner && tile.owner !== 3 && !tile.capital) {
          ctx.save();
          ctx.beginPath(); ctx.rect(r.x, r.y, ts, ts); ctx.clip();
          ctx.strokeStyle = 'rgba(255,80,80,0.42)';
          ctx.lineWidth = 1.4;
          for (var d = -ts; d < ts; d += 6) {
            ctx.beginPath();
            ctx.moveTo(r.x + d, r.y);
            ctx.lineTo(r.x + d + ts, r.y + ts);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // --- capital ----------------------------------------------------
      if (tile.capital) {
        ctx.save();
        ctx.translate(r.x + ts / 2, r.y + ts / 2);
        var cc = sideColor(tile.capital);
        ctx.shadowColor = cc; ctx.shadowBlur = 16;
        ctx.strokeStyle = cc; ctx.lineWidth = 2;
        ctx.beginPath();
        var rr = ts * 0.31;
        for (var v = 0; v < 6; v++) {
          var a = v / 6 * Math.PI * 2 - Math.PI / 2;
          var px = Math.cos(a) * rr, py = Math.sin(a) * rr;
          if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
        ctx.fillStyle = hexA(cc, 0.16); ctx.fill();
        ctx.restore();
      }

      // --- height pips -------------------------------------------------
      if (tile.elev > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        for (var e = 0; e < tile.elev; e++) ctx.fillRect(r.x + 3.5 + e * 4, r.y + 3.5, 2.6, 2.6);
      }

      // --- garrison ----------------------------------------------------
      if (owned && tile.str > 0) {
        var fs = Math.max(11, Math.floor(ts * 0.42));
        ctx.font = '700 ' + fs + 'px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillText(tile.str, r.x + ts / 2 + 1, r.y + ts / 2 + 1.5);
        ctx.fillStyle = tile.owner === 1 ? '#dcffe9' : tile.owner === 2 ? '#ffe7d2' : '#ece2ff';
        ctx.fillText(tile.str, r.x + ts / 2, r.y + ts / 2 + 0.5);
      }

      // --- capture / event flash ---------------------------------------
      var fl = flashes[i];
      if (fl) {
        var left = fl.until - now;
        if (left <= 0) delete flashes[i];
        else {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.min(0.85, (left / fl.ms) * 0.85);
          ctx.fillStyle = fl.color;
          ctx.fillRect(r.x, r.y, ts, ts);
          ctx.restore();
        }
      }
    }
  }

  // bold outline around each people's holdings, so territory reads as one body
  function drawTerritoryEdges() {
    ctx.save();
    for (var side = 1; side <= 3; side++) {
      var col = sideColor(side);
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 9;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      for (var i = 0; i < state.tiles.length; i++) {
        var t = state.tiles[i];
        if (t.owner !== side || !t.land) continue;
        edgesOf(i, function (nb) { return !nb || nb.owner !== side || !nb.land; },
          function (x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); });
      }
    }
    ctx.restore();
  }

  function drawRifts(now) {
    for (var k = rifts.length - 1; k >= 0; k--) {
      var rf = rifts[k];
      var age = (now - rf.born) / 1400;
      if (age >= 1) { rifts.splice(k, 1); continue; }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = COL.fire;
      ctx.shadowColor = COL.fire; ctx.shadowBlur = 22;
      ctx.lineWidth = 3 + (1 - age) * 5;
      // The visual rift must tell the same story as the warning and damage.
      // All event regions are rectangular, so clip the seam to the tiles that
      // EV.inRegion says belong to the warned area.
      if (rf.region) {
        var minX = state.W, minY = state.H, maxX = -1, maxY = -1;
        for (var i = 0; i < state.tiles.length; i++) {
          if (!EV.inRegion(state, i, rf.region)) continue;
          var tx = i % state.W, ty = (i / state.W) | 0;
          minX = Math.min(minX, tx); minY = Math.min(minY, ty);
          maxX = Math.max(maxX, tx); maxY = Math.max(maxY, ty);
        }
        if (maxX >= minX && maxY >= minY) {
          ctx.beginPath();
          ctx.rect(geom.ox + minX * geom.ts, geom.oy + minY * geom.ts,
                   (maxX - minX + 1) * geom.ts, (maxY - minY + 1) * geom.ts);
          ctx.clip();
        }
      }
      ctx.beginPath();
      if (rf.dir === 'v') {
        var x = geom.ox + (rf.line + 0.5) * geom.ts;
        ctx.moveTo(x, geom.oy);
        ctx.lineTo(x, geom.oy + state.H * geom.ts);
      } else {
        var y = geom.oy + (rf.line + 0.5) * geom.ts;
        ctx.moveTo(geom.ox, y);
        ctx.lineTo(geom.ox + state.W * geom.ts, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // -------------------------------------------------------------- beacon
  function drawBeacon(t) {
    var i = state.beacon;
    if (i == null || !state.tiles[i]) return;
    var c = tileCentre(i), ts = geom.ts;
    var pulse = 0.5 + 0.5 * Math.sin(t * 2.1);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, ts * (1.5 + pulse * 0.45));
    g.addColorStop(0, 'rgba(255,225,150,' + (0.40 + pulse * 0.18) + ')');
    g.addColorStop(0.35, 'rgba(255,170,60,0.14)');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - ts * 2.2, c.y - ts * 2.2, ts * 4.4, ts * 4.4);

    // slow rays
    ctx.translate(c.x, c.y);
    ctx.rotate(t * 0.25);
    ctx.strokeStyle = 'rgba(255,215,120,0.30)';
    ctx.lineWidth = 1.4;
    for (var k = 0; k < 8; k++) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, ts * 0.36);
      ctx.lineTo(0, ts * (0.72 + pulse * 0.2));
      ctx.stroke();
    }
    ctx.restore();

    // the star itself
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.shadowColor = COL.beacon; ctx.shadowBlur = 20;
    ctx.beginPath();
    var R = ts * 0.30, rr = R * 0.42;
    for (var v = 0; v < 10; v++) {
      var a = v / 10 * Math.PI * 2 - Math.PI / 2;
      var rad = (v % 2 === 0) ? R : rr;
      var px = Math.cos(a) * rad, py = Math.sin(a) * rad;
      if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    sg.addColorStop(0, '#fffbe8');
    sg.addColorStop(0.55, COL.beacon);
    sg.addColorStop(1, '#ff8a2a');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();

    if (Math.random() < 0.28) {
      particles.push({ x: c.x + (Math.random() - .5) * ts * 0.5, y: c.y,
        vx: (Math.random() - .5) * 0.3, vy: -0.5 - Math.random() * 0.6,
        g: 0, life: 1, decay: 0.011, size: 1.3, color: COL.beacon });
    }
  }

  // -------------------------------------------------------------- orders
  function drawOrders(t) {
    var ts = geom.ts;
    var dash = -(t * 26) % 12;
    previewOrders.forEach(function (o) {
      var r = tileRect(o.to);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = dash;
      ctx.lineWidth = 2.2;

      if (o.type === 'expand') {
        ctx.strokeStyle = COL.jade; ctx.shadowColor = COL.jade; ctx.shadowBlur = 10;
        ctx.strokeRect(r.x + 3, r.y + 3, ts - 6, ts - 6);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(r.x + ts / 2 - 6, r.y + ts / 2); ctx.lineTo(r.x + ts / 2 + 6, r.y + ts / 2);
        ctx.moveTo(r.x + ts / 2, r.y + ts / 2 - 6); ctx.lineTo(r.x + ts / 2, r.y + ts / 2 + 6);
        ctx.stroke();
      } else if (o.type === 'fortify') {
        ctx.strokeStyle = '#5aa9ff'; ctx.shadowColor = '#5aa9ff'; ctx.shadowBlur = 10;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(r.x + ts / 2, r.y + ts / 2, ts * 0.36, Math.PI * 0.15, Math.PI * 0.85, true);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r.x + ts / 2, r.y + ts / 2, ts * 0.28, Math.PI * 0.15, Math.PI * 0.85, true);
        ctx.stroke();
      } else if (o.type === 'raid') {
        ctx.strokeStyle = COL.fire; ctx.shadowColor = COL.fire; ctx.shadowBlur = 12;
        ctx.strokeRect(r.x + 3, r.y + 3, ts - 6, ts - 6);
        if (o.from != null) arrow(tileCentre(o.from), tileCentre(o.to), COL.fire, dash);
      }
      ctx.restore();
    });
  }

  function arrow(a, b, color, dash) {
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len;
    var sx = a.x + ux * geom.ts * 0.22, sy = a.y + uy * geom.ts * 0.22;
    var ex = b.x - ux * geom.ts * 0.30, ey = b.y - uy * geom.ts * 0.30;
    ctx.save();
    ctx.setLineDash([5, 5]); ctx.lineDashOffset = dash;
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * 9 - uy * 5, ey - uy * 9 + ux * 5);
    ctx.lineTo(ex - ux * 9 + uy * 5, ey - uy * 9 - ux * 5);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  function drawHover() {
    if (hover < 0 || !state.tiles[hover]) return;
    var r = tileRect(hover);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = 'rgba(255,255,255,0.5)'; ctx.shadowBlur = 8;
    ctx.strokeRect(r.x + 1, r.y + 1, geom.ts - 2, geom.ts - 2);
    ctx.restore();
  }

  // ---------------------------------------------------------- fx drawing
  function drawRings(now) {
    for (var k = rings.length - 1; k >= 0; k--) {
      var r = rings[k];
      var a = (now - r.born) / r.ms;
      if (a >= 1) { rings.splice(k, 1); continue; }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - a) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.thick * (1 - a * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, U.lerp(r.r0, r.r1, U.ease(a)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var k = particles.length - 1; k >= 0; k--) {
      var p = particles[k];
      p.x += p.vx; p.y += p.vy; p.vy += p.g;
      if (p.drift) p.x += Math.sin(p.y * 0.03) * 0.35;
      p.life -= p.decay;
      if (p.life <= 0 || p.y > geom.h + 20) { particles.splice(k, 1); continue; }
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.restore();
    if (particles.length > 1400) particles.splice(0, particles.length - 1400);
  }

  // standing weather: ash keeps falling for as long as the sky is shut
  function drawWeather(t) {
    if (state.mods.ashfall > 0 && Math.random() < 0.65) ashFleck();
    if (state.mods.storm > 0 && Math.random() < 0.4) ashFleck('#7fc0ff');

    if (state.mods.ashfall > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(30,22,18,0.22)';
      ctx.fillRect(0, 0, geom.w, geom.h);
      ctx.restore();
    }
    if (state.mods.rockCooled > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(90,150,190,' + (0.03 + 0.02 * Math.sin(t * 1.4)) + ')';
      ctx.fillRect(0, 0, geom.w, geom.h);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- util
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  return {
    init: init, setState: setState, push: push, tileAt: tileAt, tileRect: tileRect,
    setHover: setHover, setPreview: setPreview, resize: resize,
    sideColor: sideColor, geom: geom
  };
})();
