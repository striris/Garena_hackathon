/* ============================================================
   theme.js — Tiny Swords asset manifest + small drawing helpers
   ============================================================ */
window.CF = window.CF || {};

CF.theme = (function () {
  var BASE = 'assets/tiny-swords';
  var loaded = false;
  var started = false;
  var promise = null;
  var images = {};

  var MANIFEST = {
    ground: BASE + '/Terrain/Ground/Tilemap_Flat.png',
    water: BASE + '/Terrain/Water/Water.png',
    foam: BASE + '/Terrain/Water/Foam/Foam.png',
    shadow: BASE + '/Terrain/Ground/Shadows.png',
    tree: BASE + '/Resources/Trees/Tree.png',
    goldMine: BASE + '/Resources/Gold Mine/GoldMine_Active.png',
    woodRes: BASE + '/Resources/Resources/W_Idle.png',
    stoneRes: BASE + '/Resources/Resources/M_Idle.png',
    goldRes: BASE + '/Resources/Resources/G_Idle.png',
    castle: BASE + '/BuildingsCustom/Castle.png',
    tower: BASE + '/BuildingsCustom/Tower.png',
    chapel: BASE + '/BuildingsCustom/Chapel.png',
    forge: BASE + '/BuildingsCustom/Forge.png',
    library: BASE + '/BuildingsCustom/Library.png',
    tavern: BASE + '/BuildingsCustom/Tavern.png',
    arena: BASE + '/BuildingsCustom/Arena.png',
    alchemist: BASE + '/BuildingsCustom/Alchemist.png',
    houseBlue: BASE + '/Factions/Knights/Buildings/House/House_Blue.png',
    houseRed: BASE + '/Factions/Knights/Buildings/House/House_Red.png',
    housePurple: BASE + '/Factions/Knights/Buildings/House/House_Purple.png',
    pointer: BASE + '/UI/Pointers/01.png',
    iconRegular: BASE + '/UI/Icons/Regular_01.png',
    warriorYellow: BASE + '/Factions/Knights/Troops/Warrior/Yellow/Warrior_Yellow.png',
    warriorRed: BASE + '/Factions/Knights/Troops/Warrior/Red/Warrior_Red.png',
    warriorPurple: BASE + '/Factions/Knights/Troops/Warrior/Purple/Warrior_Purple.png',
    pawnYellow: BASE + '/Factions/Knights/Troops/Pawn/Yellow/Pawn_Yellow.png',
    pawnRed: BASE + '/Factions/Knights/Troops/Pawn/Red/Pawn_Red.png',
    pawnPurple: BASE + '/Factions/Knights/Troops/Pawn/Purple/Pawn_Purple.png',
    deco01: BASE + '/Deco/01.png',
    deco02: BASE + '/Deco/02.png',
    deco03: BASE + '/Deco/03.png',
    deco04: BASE + '/Deco/04.png',
    deco05: BASE + '/Deco/05.png',
    deco06: BASE + '/Deco/06.png'
  };

  var PALETTE = {
    1: '#f8d35b',
    2: '#ff7159',
    3: '#b893ff',
    beacon: '#ffe487',
    sea: '#153b5f',
    ink: '#fff5d6'
  };

  function loadImage(key, src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { images[key] = img; resolve(img); };
      img.onerror = function () { reject(new Error('asset_failed:' + key)); };
      img.src = src;
    });
  }

  function startLoad() {
    if (promise) return promise;
    started = true;
    promise = Promise.all(Object.keys(MANIFEST).map(function (key) {
      return loadImage(key, MANIFEST[key]);
    })).then(function () {
      loaded = true;
      document.body.classList.add('theme-ready');
      return true;
    }).catch(function (err) {
      document.body.classList.add('theme-failed');
      throw err;
    });
    return promise;
  }

  function isReady() { return loaded; }
  function hasStarted() { return started; }
  function image(key) { return images[key] || null; }

  function drawNineSlice(ctx, img, x, y, w, h, slice) {
    if (!img) return;
    var s = slice || 64;
    var iw = img.width, ih = img.height;
    var cx = iw - s * 2, cy = ih - s * 2;
    var dw = Math.max(w - s * 2, 1), dh = Math.max(h - s * 2, 1);
    ctx.drawImage(img, 0, 0, s, s, x, y, s, s);
    ctx.drawImage(img, s, 0, cx, s, x + s, y, dw, s);
    ctx.drawImage(img, iw - s, 0, s, s, x + w - s, y, s, s);
    ctx.drawImage(img, 0, s, s, cy, x, y + s, s, dh);
    ctx.drawImage(img, s, s, cx, cy, x + s, y + s, dw, dh);
    ctx.drawImage(img, iw - s, s, s, cy, x + w - s, y + s, s, dh);
    ctx.drawImage(img, 0, ih - s, s, s, x, y + h - s, s, s);
    ctx.drawImage(img, s, ih - s, cx, s, x + s, y + h - s, dw, s);
    ctx.drawImage(img, iw - s, ih - s, s, s, x + w - s, y + h - s, s, s);
  }

  function groundFrame(seed) {
    var ix = seed % 20;
    var iy = Math.floor(seed / 20) % 8;
    return { sx: ix * 32, sy: iy * 32, sw: 32, sh: 32 };
  }

  function treeFrame(seed) {
    var cols = 4, rows = 3;
    var ix = seed % cols, iy = Math.floor(seed / cols) % rows;
    return { sx: ix * 192, sy: iy * 192, sw: 192, sh: 192 };
  }

  function unitFrame(side, strong) {
    var key = strong ? { 1: 'warriorYellow', 2: 'warriorRed', 3: 'warriorPurple' }[side] :
      { 1: 'pawnYellow', 2: 'pawnRed', 3: 'pawnPurple' }[side];
    return { key: key, sx: 0, sy: 0, sw: 128, sh: 128 };
  }

  function decoKey(seed) {
    var keys = ['deco01', 'deco02', 'deco03', 'deco04', 'deco05', 'deco06'];
    return keys[seed % keys.length];
  }

  return {
    manifest: MANIFEST,
    palette: PALETTE,
    startLoad: startLoad,
    isReady: isReady,
    hasStarted: hasStarted,
    image: image,
    drawNineSlice: drawNineSlice,
    groundFrame: groundFrame,
    treeFrame: treeFrame,
    unitFrame: unitFrame,
    decoKey: decoKey
  };
})();
