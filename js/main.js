/* ============================================================
   main.js — wiring
   Turn flow, order queueing, the warning bar, the message feed,
   the chronicle and the designer console.
   ============================================================ */
(function () {
  var U = CF.util, E = CF.engine, EV = CF.events, R = CF.render, D = CF.director;

  var game = null;
  var orders = [];
  var tool = 'expand';
  var busy = false;
  var paused = false;
  var forceTurtle = false;
  var lastBotMood = '—';

  var $ = function (id) { return document.getElementById(id); };

  // ================================================================ start
  function boot() {
    R.init($('map'));
    newGame((Math.random() * 1e9) | 0);
    bindUI();
    bindIntro();
  }

  // ---------------------------------------------------------- the cold open
  // The ring is already turning behind the text, so the player sees the
  // argument of the game before reading a word of it.
  function bindIntro() {
    var el = $('intro');
    if (!el) return;
    var slide = 0;
    var LABELS = ['THE WORLD <kbd>→</kbd>', 'HOW TO PLAY <kbd>→</kbd>', 'TAKE THE RING <kbd>⏎</kbd>'];

    CF.intro.init($('introcanvas'));
    CF.intro.start();

    function go(n) {
      slide = U.clamp(n, 0, 2);
      [].forEach.call(el.querySelectorAll('.slide'), function (s) {
        s.classList.toggle('active', +s.dataset.slide === slide);
      });
      [].forEach.call(el.querySelectorAll('.dot-nav'), function (d, i) {
        d.classList.toggle('active', i === slide);
      });
      $('intro-next').innerHTML = LABELS[slide];
    }

    function dismiss() {
      if (el.classList.contains('leaving')) return;
      el.classList.add('leaving');
      setTimeout(function () {
        el.remove();
        CF.intro.stop();
        R.resize();
      }, 550);
      document.removeEventListener('keydown', keys, true);
    }

    function keys(e) {
      // swallow everything: 1/2/3 and Enter must not reach the map below
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(slide + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(slide - 1); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (slide >= 2) dismiss(); else go(slide + 1);
      }
    }

    $('intro-next').onclick = function () { if (slide >= 2) dismiss(); else go(slide + 1); };
    $('intro-skip').onclick = dismiss;
    [].forEach.call(el.querySelectorAll('.dot-nav'), function (d) {
      d.onclick = function () { go(+d.dataset.go); };
    });

    // the intro owns the keyboard until it is gone, so 1/2/3 and Enter
    // cannot leak through to the map underneath
    document.addEventListener('keydown', keys, true);
    go(0);
  }

  function newGame(seed) {
    game = E.newGame(seed);
    orders = []; busy = false; tool = 'expand';
    R.setState(game);
    R.setPreview([]);
    $('gameover').classList.add('hidden');
    $('warnbar').classList.add('hidden');
    say('world', 'A ring of islands, and a mountain under them that has never once sat still.');
    say('', 'The Ashfarers hold the west. The Saltkin hold the east. Cinder wakes at the end of turn 3.');
    setTool('expand');
    renderFeed();
    refresh();
  }

  // ============================================================== ordering
  function spent() {
    return orders.reduce(function (a, o) { return a + E.costOf(game, o.type); }, 0);
  }

  function tryOrder(i) {
    if (busy || game.over) return;
    var budget = E.income(game, 1);
    var cost = E.costOf(game, tool);
    if (spent() + cost > budget) { say('', 'Not enough income for that. You have ' + (budget - spent()) + ' left.'); return; }

    var from = null;
    if (tool === 'expand') {
      if (orders.some(function (o) { return o.type === 'expand' && o.to === i; })) { say('', 'Already claiming that square.'); return; }
      from = E.canExpand(game, 1, i);
      if (from == null) { say('', 'You can only settle empty land next to ground you already hold.'); return; }
    } else if (tool === 'fortify') {
      from = E.canFortify(game, 1, i);
      if (from == null) { say('', 'Fortify a square you hold.'); return; }
    } else {
      from = E.canRaid(game, 1, i);
      if (from == null) { say('', 'Raid an enemy square that touches your own.'); return; }
    }

    orders.push({ type: tool, to: i, from: from });
    refresh();
  }

  function removeOrder(k) { orders.splice(k, 1); refresh(); }

  // =========================================================== turn cycle
  function endTurn() {
    if (busy || game.over) return;
    busy = true;
    $('btn-end').disabled = true;

    var plan = CF.bot.plan(game, 2, forceTurtle);
    lastBotMood = plan.mood;

    var res = E.resolveTurn(game, orders, plan.orders);
    game = res.state;
    orders = [];
    R.setState(game);
    R.setPreview([]);
    R.push(res.fx);
    renderFeed();
    refresh();

    setTimeout(phaseEvent, 620);
  }

  function phaseEvent() {
    var p = game.pending;
    if (p && p.fireTurn === game.turn && !paused) {
      fireEvent(p);
      setTimeout(phaseDirector, 1700);
    } else {
      if (p && paused) say('world', 'Director paused. ' + EV.nameOf(p.template) + ' is held at the gate.');
      phaseDirector();
    }
  }

  function phaseDirector() {
    if (!game.over && game.turn % 3 === 0 && !paused) {
      // mark the previous prediction right or wrong before choosing again
      game.chronicle.forEach(function (c) { if (c.fired) D.scorePrediction(game, c); });

      var ev = D.decide(game);
      game.season = ev.season;
      game.pending = ev;
      game.chronicle.push({
        season: ev.season, decidedTurn: game.turn, fireTurn: ev.fireTurn,
        template: ev.template, intensity: ev.intensity, region: ev.region,
        warning: ev.warning, reasoning: ev.reasoning, report: ev.report,
        prediction: ev.prediction, predictionResult: 'pending',
        message: null, fired: false, measured: null, mainTarget: ev.mainTarget
      });
      say('world', 'Cinder stirs. ' + ev.warning);
    }

    game.turn += 1;
    if (!game.over) game.over = E.checkVictory(game);

    busy = false;
    $('btn-end').disabled = false;
    R.setState(game);
    renderFeed();
    refresh();
    if (game.over) showGameOver();
  }

  function fireEvent(ev) {
    var out = EV.apply(game, ev);
    if (!out.ok) {
      say('world', 'The mountain rumbled and thought better of it.');
      game.pending = null;
      return;
    }
    game = out.state;
    game.pending = null;
    game.lastTemplate = ev.template;
    game.targetHistory.push(ev.mainTarget || 0);
    D.noteUse(game, ev.template);

    R.setState(game);
    R.push(out.fx);
    banner(EV.nameOf(ev.template), out.message);
    say('world', EV.nameOf(ev.template) + ' — ' + out.message);

    var entry = game.chronicle.filter(function (c) { return c.season === ev.season; })[0];
    if (entry) { entry.fired = true; entry.message = out.message; }

    if (!game.over) game.over = E.checkVictory(game);
    renderFeed();
    refresh();
  }

  // ================================================================== UI
  function setTool(t) {
    tool = t;
    [].forEach.call(document.querySelectorAll('.tool'), function (b) {
      b.classList.toggle('active', b.dataset.tool === t);
    });
  }

  function refresh() {
    if (!game) return;
    var budget = E.income(game, 1), sp = spent();

    $('hud-turn').textContent = Math.min(game.turn, E.MAX_TURNS);
    $('hud-season').textContent = game.season;
    $('hud-a-land').textContent = E.landCount(game, 1);
    $('hud-b-land').textContent = E.landCount(game, 2);
    $('hud-a-bp').style.width = Math.min(100, game.bp[1] / E.BEACON_TO_WIN * 100) + '%';
    $('hud-b-bp').style.width = Math.min(100, game.bp[2] / E.BEACON_TO_WIN * 100) + '%';
    $('hud-a-bplabel').textContent = game.bp[1] + ' / ' + E.BEACON_TO_WIN;
    $('hud-b-bplabel').textContent = game.bp[2] + ' / ' + E.BEACON_TO_WIN;

    $('hud-income').textContent = budget;
    $('hud-spent').textContent = sp;
    $('hud-left').textContent = Math.max(0, budget - sp);
    var fill = $('hud-spendfill');
    fill.style.width = budget ? Math.min(100, sp / budget * 100) + '%' : '0%';
    fill.classList.toggle('over', sp > budget);

    var rc = E.raidCost(game);
    $('cost-raid').textContent = rc;
    $('cost-raid').classList.toggle('raised', rc > E.COST.raid);

    renderOrders();
    renderMods();
    renderWarning();
    renderChronicle();
    renderConsole();
    R.setPreview(orders);
  }

  function renderOrders() {
    var ul = $('orderlist');
    ul.innerHTML = '';
    if (!orders.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'no orders yet — pick a tool, then click the map';
      ul.appendChild(li);
      return;
    }
    orders.forEach(function (o, k) {
      var li = document.createElement('li');
      li.className = o.type;
      var icon = o.type === 'expand' ? '✚' : o.type === 'fortify' ? '⛨' : '⚔';
      var label = o.type === 'raid'
        ? E.coord(game, o.from) + ' → ' + E.coord(game, o.to)
        : E.coord(game, o.to);
      li.innerHTML = '<span class="oi">' + icon + '</span><span>' + U.cap(o.type) + ' ' + label +
                     '</span><span class="oc">−' + E.costOf(game, o.type) + '</span>';
      li.title = 'click to remove';
      li.onclick = function () { removeOrder(k); };
      ul.appendChild(li);
    });
  }

  function renderMods() {
    var box = $('modlist');
    box.innerHTML = '';
    var m = game.mods;
    function tag(txt) { var d = document.createElement('div'); d.className = 'mod'; d.textContent = txt; box.appendChild(d); }
    if (m.ashfall > 0) tag('ASHFALL · raids cost double · ' + m.ashfall + 'T');
    if (m.rockCooled > 0) tag('ROCK COOLED · height gives nothing · ' + m.rockCooled + 'T');
    if (m.storm > 0) tag('STORM · the weather favours the loser · ' + m.storm + 'T');
    var cut = 0;
    for (var i = 0; i < game.tiles.length; i++)
      if (game.tiles[i].owner === 1 && game.supply[i] !== 1) cut++;
    if (cut) tag(U.plural(cut, 'square') + ' CUT OFF · starving');
  }

  function renderWarning() {
    var bar = $('warnbar'), p = game.pending;
    if (!p) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    $('warn-title').textContent = 'WARNING · ' + EV.nameOf(p.template) + ' · INTENSITY ' + 'I'.repeat(p.intensity);
    $('warn-sub').textContent = p.warning;
    var away = p.fireTurn - game.turn;
    $('warn-count').textContent = away <= 0 ? 'this turn' : away === 1 ? 'end of this turn' : 'in ' + away + ' turns';
  }

  function say(cls, text) {
    game.feed.push({ turn: game.turn, cls: cls, text: text });
  }

  function renderFeed() {
    var el = $('feed');
    el.innerHTML = '';
    game.feed.slice(-60).forEach(function (f) {
      var d = document.createElement('div');
      d.className = 'fe ' + (f.cls || '');
      d.innerHTML = '<span class="fe-t">T' + f.turn + '</span><span class="fe-x"></span>';
      d.querySelector('.fe-x').textContent = f.text;
      el.appendChild(d);
    });
    el.scrollTop = el.scrollHeight;
  }

  function banner(title, sub) {
    var b = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    b.classList.remove('hidden');
    // restart the css animation
    var inner = b.querySelector('.banner-in');
    inner.style.animation = 'none';
    void inner.offsetWidth;
    inner.style.animation = '';
    clearTimeout(banner._t);
    banner._t = setTimeout(function () { b.classList.add('hidden'); }, 2600);
  }

  function showGameOver() {
    var o = game.over;
    $('go-title').textContent = o.winner === 0 ? 'A DRAWN RING'
      : o.winner === 1 ? 'THE ASHFARERS HOLD' : 'THE SALTKIN HOLD';
    $('go-sub').textContent = o.why + ' Cinder is still working.';
    $('gameover').classList.remove('hidden');
  }

  // ---------------------------------------------------------- chronicle
  function renderChronicle() {
    var el = $('chronicle');
    if (!game.chronicle.length) {
      el.innerHTML = '<p class="panel-note" style="border:none">Nothing yet. The mountain wakes at the end of turn 3.</p>';
      return;
    }
    el.innerHTML = '';
    game.chronicle.slice().reverse().forEach(function (c) {
      var d = document.createElement('div');
      d.className = 'ch-entry';

      var tag = c.predictionResult === 'hit' ? '<span class="tag hit">PREDICTION HELD</span>'
              : c.predictionResult === 'miss' ? '<span class="tag miss">PREDICTION WRONG</span>'
              : '<span class="tag wait">NOT YET MEASURED</span>';

      d.innerHTML =
        '<div class="ch-top">' +
          '<span class="ch-season">SEASON ' + c.season + ' · TURN ' + c.fireTurn + '</span>' +
          '<span class="ch-int">' + 'I'.repeat(c.intensity) + '</span>' +
          '<span class="ch-name">' + EV.nameOf(c.template) + '</span>' +
        '</div>' +
        '<div class="ch-body">' +
          '<div class="ch-msg"></div>' +
          '<div class="ch-why"></div>' +
          '<div class="ch-pred">' + tag + '<span class="pred-text"></span></div>' +
        '</div>';

      d.querySelector('.ch-msg').textContent = c.fired ? '“' + c.message + '”' : '(warned, not yet fired) ' + c.warning;
      d.querySelector('.ch-why').textContent = c.reasoning;
      d.querySelector('.pred-text').textContent = c.prediction.text + (c.measured ? ' — ' + c.measured : '');
      el.appendChild(d);
    });
  }

  // ------------------------------------------------------------- console
  function renderConsole() {
    var last = game.chronicle[game.chronicle.length - 1];
    $('con-report').textContent = last ? last.report : 'Cinder is asleep. It wakes at the end of turn 3.';
    $('con-reason').textContent = last ? last.reasoning : '—';

    var p = game.pending;
    $('con-pending').textContent = p
      ? EV.nameOf(p.template) + ' · intensity ' + p.intensity + (p.region ? ' · ' + EV.regionName(p.region) : '') +
        ' · fires at the end of turn ' + p.fireTurn
      : 'none — the rival is playing ' + lastBotMood;

    var mem = $('con-memory'), keys = Object.keys(game.memory);
    if (!keys.length) { mem.textContent = 'no history yet'; }
    else {
      mem.innerHTML = '';
      keys.sort().forEach(function (k) {
        var m = game.memory[k];
        var tot = m.hits + m.misses;
        var pct = tot ? Math.round(m.hits / tot * 100) : 0;
        var row = document.createElement('div');
        row.className = 'mem-row';
        row.innerHTML = '<span>' + EV.nameOf(k) + '</span>' +
                        '<span class="mbar"><i style="width:' + pct + '%"></i></span>' +
                        '<b>' + m.uses + 'x</b>';
        row.title = m.hits + ' predictions right, ' + m.misses + ' wrong';
        mem.appendChild(row);
      });
    }
  }

  // ================================================================ input
  function bindUI() {
    var cv = $('map');

    cv.addEventListener('mousemove', function (e) {
      var r = cv.getBoundingClientRect();
      var i = R.tileAt(e.clientX - r.left, e.clientY - r.top);
      R.setHover(i);
      showTooltip(i, e.clientX - r.left, e.clientY - r.top);
    });
    cv.addEventListener('mouseleave', function () { R.setHover(-1); $('tooltip').classList.add('hidden'); });
    cv.addEventListener('click', function (e) {
      var r = cv.getBoundingClientRect();
      var i = R.tileAt(e.clientX - r.left, e.clientY - r.top);
      if (i >= 0) tryOrder(i);
    });
    cv.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      var i = R.tileAt(e.clientX - r.left, e.clientY - r.top);
      for (var k = orders.length - 1; k >= 0; k--) if (orders[k].to === i) { removeOrder(k); return; }
    });

    [].forEach.call(document.querySelectorAll('.tool'), function (b) {
      b.onclick = function () { setTool(b.dataset.tool); };
    });
    [].forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.onclick = function () {
        [].forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.remove('active'); });
        [].forEach.call(document.querySelectorAll('.panel'), function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        $('tab-' + b.dataset.tab).classList.add('active');
      };
    });

    $('btn-end').onclick = endTurn;
    $('btn-clear').onclick = function () { orders = []; refresh(); };
    $('go-again').onclick = function () { newGame((Math.random() * 1e9) | 0); };
    $('con-new').onclick = function () { newGame((Math.random() * 1e9) | 0); };

    $('con-pause').onchange = function () {
      paused = this.checked;
      say('world', paused ? 'Director paused by the designer.' : 'Director resumed.');
      renderFeed();
    };
    $('con-turtle').onchange = function () {
      forceTurtle = this.checked;
      say('world', forceTurtle
        ? 'Rival forced to turtle. Sit still and watch what the mountain does about it.'
        : 'Rival returned to its own judgement.');
      renderFeed();
    };

    // template picker for the override
    var sel = $('con-override');
    EV.all().forEach(function (id) {
      var o = document.createElement('option');
      o.value = id; o.textContent = EV.nameOf(id);
      sel.appendChild(o);
    });

    $('con-apply').onclick = function () {
      var ev = {
        template: sel.value,
        intensity: +$('con-intensity').value,
        region: game.pending ? game.pending.region : 'centre',
        prediction: { metric: 'raids', dir: 'up', mag: 0.3, text: 'Chosen by a human. No prediction on record.' },
        season: game.pending ? game.pending.season : game.season + 1,
        fireTurn: game.pending ? game.pending.fireTurn : game.turn,
        mainTarget: 0
      };
      ev.warning = EV.warningFor(ev);
      var chk = CF.validator.check(game, ev);
      ev.reasoning = 'Overridden by the designer.\n\nGuardrails: ' +
        (chk.ok ? 'passed.' : 'REFUSED — ' + chk.fails.join('; ') + '. Applied anyway on human authority.');
      ev.report = game.pending ? game.pending.report : '(no report — human override)';
      ev.mainTarget = chk.mainTarget || 0;

      if (game.pending) {
        game.pending = ev;
        var entry = game.chronicle[game.chronicle.length - 1];
        if (entry && !entry.fired) {
          entry.template = ev.template; entry.intensity = ev.intensity;
          entry.warning = ev.warning; entry.reasoning = ev.reasoning; entry.prediction = ev.prediction;
        }
        say('world', 'Designer override: the next event is now ' + EV.nameOf(ev.template) + '.');
      } else {
        game.pending = ev;
        game.chronicle.push({
          season: ev.season, decidedTurn: game.turn, fireTurn: game.turn,
          template: ev.template, intensity: ev.intensity, region: ev.region,
          warning: ev.warning, reasoning: ev.reasoning, report: ev.report,
          prediction: ev.prediction, predictionResult: 'pending',
          message: null, fired: false, measured: null, mainTarget: ev.mainTarget
        });
        say('world', 'Designer queued ' + EV.nameOf(ev.template) + '.');
      }
      renderFeed();
      refresh();
    };

    $('con-fire').onclick = function () {
      if (!game.pending) { say('world', 'Nothing is queued. Pick a template and press override first.'); renderFeed(); return; }
      fireEvent(game.pending);
    };

    document.addEventListener('keydown', function (e) {
      if (e.key === '1') setTool('expand');
      else if (e.key === '2') setTool('fortify');
      else if (e.key === '3') setTool('raid');
      else if (e.key === 'Enter') endTurn();
      else if (e.key === 'Escape') { orders = []; refresh(); }
    });
  }

  // --------------------------------------------------------------- tooltip
  function showTooltip(i, px, py) {
    var el = $('tooltip');
    if (i < 0 || !game.tiles[i]) { el.classList.add('hidden'); return; }
    var t = game.tiles[i];
    var name = E.coord(game, i);

    var rows = [];
    if (!t.land) {
      rows.push(['terrain', 'open water']);
    } else {
      rows.push(['holder', t.owner ? E.SIDE[t.owner] : 'nobody']);
      rows.push(['strength', t.str]);
      rows.push(['height', t.elev + (game.mods.rockCooled > 0 ? ' (giving nothing)' : '')]);
      rows.push(['fertility', t.fert + (t.crater ? ' · ash' : '')]);
      rows.push(['defence', E.defenceValue(game, i)]);
      if (t.owner && t.owner !== 3 && game.supply[i] !== t.owner) rows.push(['supply', 'CUT OFF']);
      if (t.capital) rows.push(['', 'CAPITAL']);
    }
    if (i === game.beacon) rows.push(['', 'THE BEACON']);

    var hint = '';
    if (t.land) {
      if (tool === 'raid') {
        var src = E.canRaid(game, 1, i);
        if (src != null) hint = 'raid from ' + E.coord(game, src) + ': ' +
          E.attackValue(game, src, 1) + ' against ' + E.defenceValue(game, i) +
          (E.attackValue(game, src, 1) > E.defenceValue(game, i) ? ' — it falls' : ' — it holds');
      } else if (tool === 'expand') {
        if (E.canExpand(game, 1, i) != null) hint = 'settle for ' + E.COST.expand + ', starts at strength 1';
      } else if (tool === 'fortify') {
        if (E.canFortify(game, 1, i) != null) hint = 'fortify for ' + E.COST.fortify + ' → strength ' + (t.str + 2);
      }
    }

    el.innerHTML = '<h4 style="color:' + (t.owner ? R.sideColor(t.owner) : '#9b92ad') + '">' + name + '</h4>' +
      rows.map(function (r) {
        return '<div class="tt-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>';
      }).join('') +
      (hint ? '<div class="tt-hint">' + hint + '</div>' : '');

    el.classList.remove('hidden');
    var w = el.offsetWidth, h = el.offsetHeight;
    var wrap = $('canvas-wrap').getBoundingClientRect();
    var x = px + 16, y = py + 16;
    if (x + w > wrap.width - 6) x = px - w - 16;
    if (y + h > wrap.height - 6) y = py - h - 16;
    el.style.left = Math.max(6, x) + 'px';
    el.style.top = Math.max(6, y) + 'px';
  }

  // expose for headless balance runs from the console
  window.CF.game = { get state() { return game; }, newGame: newGame, endTurn: endTurn };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
