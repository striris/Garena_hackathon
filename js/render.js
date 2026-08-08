/* ============================================================
   render.js — Tiny Swords presentation layer
   Gameplay stays deterministic; visuals switch to sprite composition.
   ============================================================ */
CF.render = (function () {
  var U = CF.util, E = CF.engine, EV = CF.events, T = CF.theme;

  var cv, ctx, dpr = 1;
  var resizeObserver = null, resizeFrame = 0;
  var state = null;
  var geom = { ts: 40, ox: 0, oy: 0, w: 0, h: 0 };

  var particles = [];
  var rings = [];
  var flashes = {};
  var rifts = [];
  var hover = -1;
  var previewOrders = [];
  var legalTargets = [];
  var legalType = 'expand';
  var shake = 0, shakeT = 0;
  var t0 = performance.now();

  function sideColor(o) {
    return T.palette[o] || '#d9ca9c';
  }

  function sideDeep(o) {
    return o === 1 ? '#8b6b12' : o === 2 ? '#8c3628' : o === 3 ? '#65488e' : '#4a4334';
  }

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    T.startLoad().catch(function () {});
    resize();
    window.addEventListener('resize', queueResize);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(queueResize);
      resizeObserver.observe(cv);
    }
    requestAnimationFrame(loop);
  }

  function queueResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(function () {
      resizeFrame = 0;
      resize();
    });
  }

  function resize() {
    if (!cv) return;
    // clientWidth/clientHeight describe the canvas' untransformed CSS box.
    // The old parent rect included its decorative border and became stale
    // whenever a flex sibling (such as the event warning) changed size.
    var width = cv.clientWidth;
    var height = cv.clientHeight;
    if (!width || !height) {
      var r = cv.getBoundingClientRect();
      width = r.width;
      height = r.height;
    }
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pixelWidth = Math.max(1, Math.floor(width * dpr));
    var pixelHeight = Math.max(1, Math.floor(height * dpr));
    if (cv.width !== pixelWidth) cv.width = pixelWidth;
    if (cv.height !== pixelHeight) cv.height = pixelHeight;
    geom.w = width;
    geom.h = height;
    layout();
  }

  function layout() {
    if (!state) return;
    var pad = 22;
    var ts = Math.floor(Math.min((geom.w - pad * 2) / state.W, (geom.h - pad * 2) / state.H));
    // Compact landscape screens need a smaller floor to keep the entire
    // ladder visible. Hit testing reads this same geometry, so shrinking a
    // tile never introduces the pointer offset caused by CSS transforms.
    geom.ts = Math.max(geom.h < 300 ? 18 : 24, ts);
    geom.ox = Math.floor((geom.w - geom.ts * state.W) / 2);
    geom.oy = Math.floor((geom.h - geom.ts * state.H) / 2);
  }

  function setState(s) { state = s; layout(); }
  function setHover(i) { hover = i; }
  function setPreview(list) { previewOrders = list || []; }
  function setLegalTargets(list, type) { legalTargets = list || []; legalType = type || 'expand'; }

  function tileAt(px, py) {
    if (!state) return -1;
    var x = Math.floor((px - geom.ox) / geom.ts);
    var y = Math.floor((py - geom.oy) / geom.ts);
    if (x < 0 || y < 0 || x >= state.W || y >= state.H) return -1;
    return y * state.W + x;
  }

  function pointFromClient(clientX, clientY) {
    if (!cv) return { x: -1, y: -1 };
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return { x: -1, y: -1 };
    // getBoundingClientRect includes any visual CSS scaling. Convert back to
    // the coordinate system used by geom so hit testing remains exact.
    return {
      x: (clientX - r.left) * geom.w / r.width,
      y: (clientY - r.top) * geom.h / r.height
    };
  }

  function tileRect(i) {
    var x = i % state.W, y = (i / state.W) | 0;
    return { x: geom.ox + x * geom.ts, y: geom.oy + y * geom.ts, s: geom.ts };
  }

  function tileCentre(i) {
    var r = tileRect(i);
    return { x: r.x + r.s / 2, y: r.y + r.s / 2 };
  }

  function ownershipInsets(index, owner) {
    var W = state.W, x = index % W, y = (index / W) | 0;
    var edge = Math.max(2, Math.floor(geom.ts * 0.14));
    function linked(neighbor) {
      return neighbor && neighbor.land && neighbor.owner === owner;
    }
    return {
      left: linked(x > 0 ? state.tiles[index - 1] : null) ? 0 : edge,
      right: linked(x < W - 1 ? state.tiles[index + 1] : null) ? 0 : edge,
      top: linked(y > 0 ? state.tiles[index - W] : null) ? 0 : edge,
      bottom: linked(y < state.H - 1 ? state.tiles[index + W] : null) ? 0 : edge
    };
  }

  function ownershipPath(r, insets) {
    ctx.beginPath();
    ctx.moveTo(r.x + insets.left, r.y + insets.top);
    ctx.lineTo(r.x + r.s - insets.right, r.y + insets.top);
    ctx.lineTo(r.x + r.s - insets.right, r.y + r.s - insets.bottom);
    ctx.lineTo(r.x + insets.left, r.y + r.s - insets.bottom);
    ctx.closePath();
  }

  function push(fx) {
    if (!fx || !state) return;
    fx.forEach(function (f) {
      switch (f.kind) {
        case 'capture':
          flash(f.at, sideColor(f.side), 700);
          burst(f.at, sideColor(f.side), 20, 2.2);
          ring(f.at, sideColor(f.side), 1.8, 520);
          if (f.from != null) tracer(f.from, f.at, sideColor(f.side));
          break;
        case 'synergy':
          flash(f.at, '#fff0a8', 850);
          ring(f.at, '#fff0a8', 2.8, 900);
          (f.sources || []).forEach(function (from) { tracer(from, f.at, sideColor(f.side)); });
          break;
        case 'pressure':
          flash(f.at, '#ff9b62', 500);
          burst(f.at, '#ff9b62', 8, 1.2);
          break;
        case 'repel':
          flash(f.at, '#ffffff', 260);
          burst(f.at, '#f1ead6', 10, 1.2);
          if (f.from != null) tracer(f.from, f.at, '#fff6d4');
          break;
        case 'invalid':
          flash(f.at, '#ff5f52', 420);
          ring(f.at, '#ff7b68', 2.2, 440);
          break;
        case 'settle':
          flash(f.at, sideColor(f.side), 520);
          ring(f.at, sideColor(f.side), 1.3, 420);
          break;
        case 'surge':
          flash(f.at, sideColor(f.side), 760);
          burst(f.at, sideColor(f.side), 18, 2.0);
          ring(f.at, '#fff0a8', 2.0, 620);
          break;
        case 'settle3':
          flash(f.at, sideColor(3), 700);
          burst(f.at, sideColor(3), 16, 1.6);
          break;
        case 'clash':
          flash(f.at, '#fff7d8', 420);
          burst(f.at, '#fff7d8', 14, 1.5);
          break;
        case 'fortify':
          burst(f.at, '#88c7ff', 10, 1.0, -1.6);
          break;
        case 'starve':
          burst(f.at, '#8d7c68', 14, 1.1);
          break;
        case 'beaconTick':
          ring(f.at, T.palette.beacon, 2.4, 780);
          break;
        case 'sink':
          flash(f.at, '#5fa3d9', 600);
          burst(f.at, '#99d6ff', 24, 2.0, -1.0);
          ring(f.at, '#5eaee5', 1.6, 620);
          break;
        case 'rise':
          flash(f.at, '#ff8d44', 900);
          burst(f.at, '#ffe487', 26, 2.5, -2.2);
          ring(f.at, '#ff7a48', 2.0, 760);
          break;
        case 'bless':
          burst(f.at, '#8aff9d', 12, 1.3, -1.2);
          break;
        case 'quake':
          shake = Math.max(shake, f.power * 5);
          shakeT = performance.now();
          break;
        case 'shock':
          ring(f.at, '#ff6f3f', f.r || 2, 1100, true);
          lavaBurst(f.at, f.r || 2);
          break;
        case 'rift':
          rifts.push({ line: f.line, dir: f.dir, region: f.region, born: performance.now() });
          break;
        case 'flood':
          floodSweep(f.region);
          break;
        case 'skyDark':
          for (var i = 0; i < 90; i++) ashFleck();
          break;
        case 'cool':
          for (var j = 0; j < 40; j++) ashFleck('#a6cbdf');
          break;
        case 'storm':
          for (var k = 0; k < 60; k++) ashFleck('#8fd0ff');
          break;
        case 'beaconMove':
          if (f.from != null) {
            burst(f.from, T.palette.beacon, 18, 2.3);
            ring(f.from, T.palette.beacon, 2, 700);
          }
          ring(f.to, T.palette.beacon, 3.2, 1200, true);
          burst(f.to, T.palette.beacon, 36, 2.9, -1.5);
          flash(f.to, T.palette.beacon, 1200);
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
        size: 1 + Math.random() * 2.6, color: color
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
        g: 0, life: 1, decay: 0.05, size: 1.8, color: color
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
        size: 1.4 + Math.random() * 3.4,
        color: Math.random() < .45 ? T.palette.beacon : Math.random() < .6 ? '#ff6f3f' : '#ffa55a'
      });
    }
  }

  function ashFleck(color) {
    particles.push({
      x: Math.random() * geom.w, y: -10 - Math.random() * geom.h,
      vx: -0.25 + Math.random() * 0.5, vy: 0.35 + Math.random() * 0.7,
      g: 0, life: 1, decay: 0.0016, size: 0.8 + Math.random() * 1.7,
      color: color || '#d6ceb0', drift: true
    });
  }

  function floodSweep(region) {
    for (var i = 0; i < state.tiles.length; i++) {
      if (!CF.events.inRegion(state, i, region)) continue;
      if (Math.random() < 0.5) burst(i, '#6fc2ff', 4, 1.0, -0.6);
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!ctx) return;
    draw(now);
  }

  function draw(now) {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, geom.w, geom.h);
    ctx.imageSmoothingEnabled = false;

    if (!T.isReady()) {
      drawLoading(now);
      ctx.restore();
      return;
    }

    if (!state) {
      drawLoading(now);
      ctx.restore();
      return;
    }

    if (shake > 0.05) {
      var age = (now - shakeT) / 700;
      var amp = shake * Math.max(0, 1 - age);
      if (age >= 1) shake = 0;
      ctx.translate(Math.sin(now * 0.07) * amp, Math.cos(now * 0.093) * amp);
    }

    var t = (now - t0) / 1000;
    drawOcean(t);
    drawLandShadow();
    drawTiles(t, now);
    drawTerritoryEdges();
    drawRifts(now);
    drawBeacon(t);
    drawLegalTargets(t);
    drawOrders(t);
    drawHover();
    drawRings(now);
    drawParticles();
    drawWeather(t);
    ctx.restore();
  }

  function drawLoading(now) {
    var t = (now - t0) / 1000;
    var grad = ctx.createLinearGradient(0, 0, 0, geom.h);
    grad.addColorStop(0, '#11213a');
    grad.addColorStop(1, '#070d16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, geom.w, geom.h);
    ctx.fillStyle = '#fff5d6';
    ctx.font = '700 22px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LOADING TINY SWORDS', geom.w / 2, geom.h / 2 - 8);
    ctx.font = '700 12px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,245,214,' + (0.5 + 0.5 * Math.sin(t * 3)) + ')';
    ctx.fillText('Preparing the battlefield...', geom.w / 2, geom.h / 2 + 18);
  }

  function drawOcean(t) {
    var base = ctx.createLinearGradient(0, 0, 0, geom.h);
    base.addColorStop(0, '#10263c');
    base.addColorStop(1, '#0a1626');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, geom.w, geom.h);
    var water = T.image('water');
    if (water) {
      var step = 56;
      var offx = Math.floor((t * 14) % step);
      var offy = Math.floor((t * 9) % step);
      for (var y = -step; y < geom.h + step; y += step) {
        for (var x = -step; x < geom.w + step; x += step) {
          ctx.globalAlpha = 0.18;
          ctx.drawImage(water, x - offx, y - offy, step, step);
        }
      }
      ctx.globalAlpha = 1;
    }

    var glow = ctx.createRadialGradient(geom.w * 0.5, geom.h * 0.48, 0, geom.w * 0.5, geom.h * 0.48, Math.max(geom.w, geom.h) * 0.7);
    glow.addColorStop(0, 'rgba(255,150,60,0.08)');
    glow.addColorStop(0.45, 'rgba(51,130,190,0.03)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, geom.w, geom.h);
  }

  function drawLandShadow() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.42)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    for (var i = 0; i < state.tiles.length; i++) {
      if (!state.tiles[i].land) continue;
      var r = tileRect(i);
      ctx.fillRect(r.x + 2, r.y + 4, r.s - 4, r.s - 2);
    }
    ctx.restore();
  }

  function drawTiles(t, now) {
    for (var i = 0; i < state.tiles.length; i++) {
      var tile = state.tiles[i];
      if (!tile.land) continue;
      var r = tileRect(i);
      var seed = Math.floor(U.hash32(i * 7717 + state.seed) * 160);
      drawGroundTile(r, tile, seed);
      drawTileFertility(r, tile, seed, t);
      drawTileOwnership(r, tile, i);
      drawTileDeco(r, tile, seed);
      drawTileSprite(r, tile);
      drawTileStrength(r, tile);
      drawTileOverlay(r, tile);
      drawTileFlash(r, i, now);
    }
  }

  function drawGroundTile(r, tile, seed) {
    var ground = T.image('ground');
    var frame = T.groundFrame(seed);
    if (ground) ctx.drawImage(ground, frame.sx, frame.sy, frame.sw, frame.sh, r.x, r.y, r.s, r.s);
    else {
      ctx.fillStyle = '#5d6f42';
      ctx.fillRect(r.x, r.y, r.s, r.s);
    }

    var top = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.s);
    top.addColorStop(0, 'rgba(255,255,255,' + (0.04 + tile.elev * 0.03) + ')');
    top.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = top;
    ctx.fillRect(r.x, r.y, r.s, r.s);

    ctx.strokeStyle = tile.crater ? 'rgba(255,134,71,0.55)' : 'rgba(14,22,32,0.36)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.s - 1, r.s - 1);

    if (tile.elev > 0) {
      ctx.fillStyle = 'rgba(70,45,24,0.40)';
      ctx.fillRect(r.x, r.y + r.s - Math.min(10, 2 + tile.elev * 2), r.s, Math.min(10, 2 + tile.elev * 2));
      ctx.fillStyle = 'rgba(255,237,196,0.72)';
      for (var e = 0; e < tile.elev; e++) ctx.fillRect(r.x + 4 + e * 5, r.y + 4, 3, 3);
    }
  }

  function drawTileFertility(r, tile, seed, t) {
    if (tile.fert > 0) {
      ctx.save();
      ctx.globalAlpha = 0.09 + tile.fert * 0.05;
      ctx.fillStyle = tile.crater ? '#ff8a4c' : '#b7ff74';
      ctx.fillRect(r.x, r.y, r.s, r.s);
      ctx.restore();
    }
    if (tile.crater) {
      var cg = ctx.createRadialGradient(r.x + r.s / 2, r.y + r.s / 2, 0, r.x + r.s / 2, r.y + r.s / 2, r.s * 0.75);
      cg.addColorStop(0, 'rgba(255,170,72,' + (0.14 + 0.10 * Math.sin(t * 2.2 + seed)) + ')');
      cg.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(r.x - 2, r.y - 2, r.s + 4, r.s + 4);
    }
  }

  function drawTileOwnership(r, tile, index) {
    if (!tile.owner) return;
    var col = sideColor(tile.owner), deep = sideDeep(tile.owner);
    var insets = ownershipInsets(index, tile.owner);
    var og = ctx.createLinearGradient(r.x, r.y, r.x + r.s, r.y + r.s);
    og.addColorStop(0, hexA(col, 0.15));
    og.addColorStop(1, hexA(deep, 0.26));
    ctx.fillStyle = og;
    ownershipPath(r, insets);
    ctx.fill();
    ctx.strokeStyle = hexA(col, 0.5);
    ctx.lineWidth = 1.1;
    ownershipPath(r, {
      left: insets.left + 0.6,
      right: insets.right + 0.6,
      top: insets.top + 0.6,
      bottom: insets.bottom + 0.6
    });
    ctx.stroke();

    if (state.supply[index] !== tile.owner && tile.owner !== 3 && !tile.capital) {
      ctx.save();
      ownershipPath(r, insets);
      ctx.clip();
      ctx.strokeStyle = 'rgba(130,37,24,0.55)';
      ctx.lineWidth = 1.5;
      for (var d = -r.s; d < r.s; d += 6) {
        ctx.beginPath();
        ctx.moveTo(r.x + d, r.y);
        ctx.lineTo(r.x + d + r.s, r.y + r.s);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawTileDeco(r, tile, seed) {
    if (tile.owner === 0 && tile.fert >= 3) {
      drawAnchoredImage(T.image('goldMine'), r.x + r.s * 0.02, r.y - r.s * 0.18, r.s * 0.95, r.s * 0.8);
      return;
    }
    if (tile.owner === 0 && tile.elev >= 2 && seed % 4 === 0) {
      var tree = T.image('tree');
      var frame = T.treeFrame(seed);
      if (tree) ctx.drawImage(tree, frame.sx, frame.sy, frame.sw, frame.sh, r.x - r.s * 0.18, r.y - r.s * 0.65, r.s * 1.38, r.s * 1.38);
      return;
    }
    if (tile.owner === 0 && seed % 5 === 0) {
      drawAnchoredImage(T.image(T.decoKey(seed)), r.x + r.s * 0.14, r.y + r.s * 0.28, r.s * 0.52, r.s * 0.52);
    }

  }

  function drawTileOverlay(r, tile) {
    if (tile.relay) {
      ctx.save();
      var cx = r.x + r.s * 0.5, cy = r.y + r.s * 0.72, rr = r.s * 0.16;
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(24,20,18,0.82)';
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = Math.max(1.5, r.s * 0.045);
      ctx.fillRect(-rr, -rr, rr * 2, rr * 2);
      ctx.strokeRect(-rr, -rr, rr * 2, rr * 2);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#fff4bf';
      ctx.font = 'bold ' + Math.max(8, Math.floor(r.s * 0.22)) + 'px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('R', 0, 0.5);
      ctx.restore();
    }

    if (tile.temporaryBridge) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,123,62,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(r.x + 4, r.y + 4, r.s - 8, r.s - 8);
      ctx.restore();
    }
  }

  function drawTileSprite(r, tile) {
    if (tile.capital) {
      drawAnchoredImage(T.image('castle'), r.x - r.s * 0.35, r.y - r.s * 0.92, r.s * 1.7, r.s * 1.5);
      drawPennant(r, sideColor(tile.capital));
    } else if (tile.owner && tile.owner !== 3 && tile.str >= 4) {
      drawAnchoredImage(T.image(tile.owner === 1 ? 'houseBlue' : 'houseRed'), r.x + r.s * 0.02, r.y - r.s * 0.40, r.s * 0.88, r.s * 1.15);
    } else if (tile.owner === 3 && tile.str >= 3) {
      drawAnchoredImage(T.image('housePurple'), r.x + r.s * 0.02, r.y - r.s * 0.40, r.s * 0.88, r.s * 1.15);
    }

    if (tile.owner) {
      var frame = T.unitFrame(tile.owner, tile.str >= 4);
      var img = T.image(frame.key);
      if (img) ctx.drawImage(img, frame.sx, frame.sy, frame.sw, frame.sh, r.x - r.s * 0.16, r.y - r.s * 0.47, r.s * 1.32, r.s * 1.32);
    }
  }

  function drawPennant(r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(42,18,12,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x + r.s * 0.52, r.y + r.s * 0.15);
    ctx.lineTo(r.x + r.s * 0.52, r.y - r.s * 0.12);
    ctx.lineTo(r.x + r.s * 0.75, r.y - r.s * 0.02);
    ctx.lineTo(r.x + r.s * 0.52, r.y + r.s * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawTileStrength(r, tile) {
    if (!tile.owner || tile.str <= 0) return;
    var px = r.x + r.s * 0.06, py = r.y + r.s * 0.62, pw = Math.max(18, r.s * 0.34), ph = Math.max(16, r.s * 0.24);
    ctx.fillStyle = 'rgba(28,20,13,0.85)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = hexA(sideColor(tile.owner), 0.65);
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    ctx.font = '700 ' + Math.max(10, Math.floor(r.s * 0.22)) + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff5d6';
    ctx.fillText(tile.str, px + pw / 2, py + ph / 2 + 0.5);
  }

  function drawTileFlash(r, i, now) {
    var fl = flashes[i];
    if (!fl) return;
    var left = fl.until - now;
    if (left <= 0) { delete flashes[i]; return; }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(0.85, (left / fl.ms) * 0.85);
    ctx.fillStyle = fl.color;
    ctx.fillRect(r.x, r.y, r.s, r.s);
    ctx.restore();
  }

  function drawTerritoryEdges() {
    ctx.save();
    for (var side = 1; side <= 3; side++) {
      var col = sideColor(side);
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      for (var i = 0; i < state.tiles.length; i++) {
        var t = state.tiles[i];
        if (t.owner !== side || !t.land) continue;
        edgesOf(i, function (nb) { return !nb || nb.owner !== side || !nb.land; }, function (x1, y1, x2, y2) {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        });
      }
    }
    ctx.restore();
  }

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

  function drawRifts(now) {
    for (var k = rifts.length - 1; k >= 0; k--) {
      var rf = rifts[k];
      var age = (now - rf.born) / 1400;
      if (age >= 1) { rifts.splice(k, 1); continue; }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = '#ff7a48';
      ctx.shadowColor = '#ff7a48';
      ctx.shadowBlur = 18;
      ctx.lineWidth = 3 + (1 - age) * 5;
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

  function drawBeacon(t) {
    var i = state.beacon;
    if (i == null || !state.tiles[i]) return;
    var c = tileCentre(i), ts = geom.ts;
    var owner = state.tiles[i].owner;
    var supplied = !owner || owner === 3 || state.supply[i] === owner;
    ctx.save();
    if (!supplied) ctx.globalAlpha = 0.34;
    var pulse = 0.5 + 0.5 * Math.sin(t * 2.1);
    var tower = T.image('tower');
    if (tower) drawAnchoredImage(tower, c.x - ts * 0.7, c.y - ts * 1.55, ts * 1.4, ts * 1.7);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, ts * (1.5 + pulse * 0.45));
    g.addColorStop(0, 'rgba(255,225,150,' + (0.40 + pulse * 0.18) + ')');
    g.addColorStop(0.35, 'rgba(255,170,60,0.14)');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - ts * 2.2, c.y - ts * 2.2, ts * 4.4, ts * 4.4);
    ctx.restore();

    ctx.save();
    ctx.translate(c.x, c.y - ts * 0.6);
    ctx.shadowColor = T.palette.beacon;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    var R = ts * 0.18, rr = R * 0.42;
    for (var v = 0; v < 10; v++) {
      var a = v / 10 * Math.PI * 2 - Math.PI / 2;
      var rad = v % 2 === 0 ? R : rr;
      var px = Math.cos(a) * rad, py = Math.sin(a) * rad;
      if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    sg.addColorStop(0, '#fffbe8');
    sg.addColorStop(0.55, T.palette.beacon);
    sg.addColorStop(1, '#ff8a2a');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();

    if (Math.random() < 0.28) {
      particles.push({
        x: c.x + (Math.random() - .5) * ts * 0.5, y: c.y - ts * 0.55,
        vx: (Math.random() - .5) * 0.3, vy: -0.5 - Math.random() * 0.6,
        g: 0, life: 1, decay: 0.011, size: 1.3, color: T.palette.beacon
      });
    }
    ctx.restore();
  }

  function drawLegalTargets(t) {
    var pulse = 0.76 + Math.sin(t * 3.2) * 0.16;
    legalTargets.forEach(function (target) {
      var index = typeof target === 'number' ? target : target.i;
      var special = typeof target === 'object' && target.special;
      var r = tileRect(index);
      var color = legalType === 'raid' ? '#ff7159' : legalType === 'fortify' ? '#79bdf7' : sideColor(1);
      if (special) color = '#ffe487';
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = special ? 20 : 15;
      ctx.lineWidth = special ? 4.2 : 3.1;
      if (legalType === 'fortify') {
        ctx.beginPath();
        ctx.arc(r.x + r.s / 2, r.y + r.s / 2, r.s * .42, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        var inset = special ? 1 : 3;
        ctx.setLineDash([5, 3]);
        ctx.lineDashOffset = -(t * 20) % 8;
        ctx.strokeRect(r.x + inset, r.y + inset, r.s - inset * 2, r.s - inset * 2);
      }
      ctx.restore();
    });
  }

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
        ctx.strokeStyle = sideColor(1);
        ctx.shadowColor = sideColor(1);
        ctx.shadowBlur = 10;
        ctx.strokeRect(r.x + 3, r.y + 3, ts - 6, ts - 6);
      } else if (o.type === 'fortify') {
        ctx.strokeStyle = '#79bdf7';
        ctx.shadowColor = '#79bdf7';
        ctx.shadowBlur = 10;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(r.x + ts / 2, r.y + ts / 2, ts * 0.34, 0, Math.PI * 2);
        ctx.stroke();
      } else if (o.type === 'raid') {
        ctx.strokeStyle = '#ff7159';
        ctx.shadowColor = '#ff7159';
        ctx.shadowBlur = 12;
        ctx.strokeRect(r.x + 3, r.y + 3, ts - 6, ts - 6);
        if (o.from != null) arrow(tileCentre(o.from), tileCentre(o.to), '#ff7159', dash);
      }
      var pointer = T.image('pointer');
      if (pointer) ctx.drawImage(pointer, r.x + ts * 0.58, r.y - ts * 0.18, ts * 0.44, ts * 0.44);
      ctx.restore();
    });
  }

  function arrow(a, b, color, dash) {
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len;
    var sx = a.x + ux * geom.ts * 0.22, sy = a.y + uy * geom.ts * 0.22;
    var ex = b.x - ux * geom.ts * 0.30, ey = b.y - uy * geom.ts * 0.30;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = dash;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * 9 - uy * 5, ey - uy * 9 + ux * 5);
    ctx.lineTo(ex - ux * 9 + uy * 5, ey - uy * 9 - ux * 5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawHover() {
    if (hover < 0 || !state.tiles[hover]) return;
    var r = tileRect(hover);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,245,214,0.92)';
    ctx.lineWidth = 1.7;
    ctx.shadowColor = 'rgba(255,245,214,0.6)';
    ctx.shadowBlur = 9;
    ctx.strokeRect(r.x + 1, r.y + 1, geom.ts - 2, geom.ts - 2);
    var pointer = T.image('pointer');
    if (pointer) ctx.drawImage(pointer, r.x + geom.ts * 0.04, r.y - geom.ts * 0.10, geom.ts * 0.36, geom.ts * 0.36);
    ctx.restore();
  }

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
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
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

  function drawWeather(t) {
    if (state.mods.ashfall > 0 && Math.random() < 0.65) ashFleck();
    if (state.mods.storm > 0 && Math.random() < 0.4) ashFleck('#7fc0ff');

    if (state.mods.ashfall > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(58,42,24,0.18)';
      ctx.fillRect(0, 0, geom.w, geom.h);
      ctx.restore();
    }
    if (state.mods.rockCooled > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(140,190,225,' + (0.03 + 0.02 * Math.sin(t * 1.4)) + ')';
      ctx.fillRect(0, 0, geom.w, geom.h);
      ctx.restore();
    }
  }

  function drawAnchoredImage(img, x, y, w, h) {
    if (!img) return;
    ctx.drawImage(img, x, y, w, h);
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  return {
    init: init,
    setState: setState,
    push: push,
    tileAt: tileAt,
    pointFromClient: pointFromClient,
    tileRect: tileRect,
    setHover: setHover,
    setPreview: setPreview,
    setLegalTargets: setLegalTargets,
    resize: resize,
    sideColor: sideColor,
    geom: geom
  };
})();
