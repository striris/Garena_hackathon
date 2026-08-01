/* ============================================================
   util.js — small shared helpers
   Deterministic RNG lives here so any match can be replayed
   exactly from its seed.
   ============================================================ */
window.CF = window.CF || {};

CF.util = (function () {

  // --- deterministic PRNG -------------------------------------------------
  // The seed is carried inside the game state, so every function that needs
  // randomness advances the state's own counter rather than Math.random().
  function hash32(n) {
    n |= 0;
    n = (n + 0x6D2B79F5) | 0;
    var t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // rng bound to a mutable holder: { seed: int }
  function rng(holder) {
    return function () {
      holder.seed = (holder.seed + 1) | 0;
      return hash32(holder.seed * 2654435761);
    };
  }

  function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }
  function irand(rand, lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }

  function shuffled(rand, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // --- geometry -----------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

  function deepClone(o) {
    if (o === null || typeof o !== 'object') return o;
    if (ArrayBuffer.isView(o)) return new o.constructor(o);   // supply maps are typed arrays
    if (Array.isArray(o)) { var a = new Array(o.length); for (var i = 0; i < o.length; i++) a[i] = deepClone(o[i]); return a; }
    var r = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = deepClone(o[k]);
    return r;
  }

  // --- text ---------------------------------------------------------------
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  return { hash32: hash32, rng: rng, pick: pick, irand: irand, shuffled: shuffled,
           clamp: clamp, lerp: lerp, ease: ease, deepClone: deepClone,
           plural: plural, cap: cap };
})();
