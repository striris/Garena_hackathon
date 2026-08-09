/* ============================================================
   main.js — wiring
   Turn flow, order queueing, the warning bar, the message feed,
   the chronicle and the designer console.
   ============================================================ */
(function () {
  var U = CF.util, E = CF.engine, EV = CF.events, R = CF.render, D = CF.director;

  var game = null;
  var orders = [];
  var boostNext = false;
  var tool = 'expand';
  var busy = false;
  var paused = false;
  var forceTurtle = false;
  var lastBotEffort = null;
  var lastBotMood = '—';
  var matchSerial = 0;
  var matchId = '';
  var profileSaved = false;
  var directorAudit = null;
  var aiHealth = { ready: false, source: 'FALLBACK', reason: 'checking' };
  var saltkinAI = null;
  var aiWaits = {};
  var thinkingTimer = 0;
  var thinkingFocus = null;
  var flowSerial = 0;
  var currentRun = null;
  var flowTimers = [];

  var $ = function (id) { return document.getElementById(id); };

  var THINKING_COPY = {
    doctrine: {
      kicker: 'SALTKIN WAR COUNCIL', title: 'Reading the resolved battlefield',
      stages: ['Tracing supplied routes.', 'Comparing three trusted cards.', 'Reading the player’s settled habits.', 'Sealing a three-turn strategy card.']
    },
    orders: {
      kicker: 'SALTKIN COMMAND TENT', title: 'Sealing the rival orders',
      stages: ['Placing the first command stone.', 'Testing the second command.', 'Assigning any supply tokens.', 'Both envelopes are now sealed.']
    },
    director: {
      kicker: 'CINDER DIRECTOR', title: 'Considering possible futures',
      stages: ['Reading only resolved history.', 'Simulating candidate world events.', 'Rejecting unsafe or unfair outcomes.', 'Writing the one-turn warning.']
    }
  };

  function interactionLocked() {
    return !!(busy || Object.keys(aiWaits).length);
  }

  function activeWait() {
    var keys = Object.keys(aiWaits);
    if (!keys.length) return null;
    return aiWaits[keys[keys.length - 1]];
  }

  function renderAIWait() {
    var overlay = $('ai-thinking');
    if (!overlay) return;
    var wait = activeWait();
    if (!wait) {
      overlay.classList.add('hidden');
      overlay.classList.remove('director', 'fallback');
      overlay.setAttribute('aria-hidden', 'true');
      if (thinkingTimer) clearInterval(thinkingTimer);
      thinkingTimer = 0;
      syncControls();
      if (!interactionLocked() && thinkingFocus && document.contains(thinkingFocus) && !thinkingFocus.disabled) {
        var focus = thinkingFocus;
        requestAnimationFrame(function () { focus.focus(); });
      }
      thinkingFocus = null;
      return;
    }
    var copy = THINKING_COPY[wait.kind] || THINKING_COPY.orders;
    var elapsed = Math.max(0, Date.now() - wait.startedAt);
    var stage = Math.floor(elapsed / 1350) % copy.stages.length;
    $('thinking-kicker').textContent = wait.kicker || copy.kicker;
    $('thinking-title').textContent = wait.title || copy.title;
    $('thinking-detail').textContent = wait.detail || copy.stages[stage];
    $('thinking-elapsed').textContent = wait.footer ||
      ('The command table is locked · ' + Math.floor(elapsed / 1000) + 's elapsed');
    overlay.classList.remove('hidden');
    overlay.classList.toggle('director', wait.kind === 'director');
    overlay.classList.toggle('fallback', !!wait.fallback);
    overlay.setAttribute('aria-hidden', 'false');
    if (!thinkingTimer) thinkingTimer = setInterval(renderAIWait, 450);
    syncControls();
  }

  function beginAIWait(key, kind, detail) {
    if (!Object.keys(aiWaits).length) thinkingFocus = document.activeElement;
    aiWaits[key] = { kind: kind, detail: detail || '', startedAt: Date.now(), fallback: false };
    renderAIWait();
  }

  function updateAIWait(key, patch) {
    if (!aiWaits[key]) return;
    Object.keys(patch || {}).forEach(function (name) { aiWaits[key][name] = patch[name]; });
    renderAIWait();
  }

  function endAIWait(key) {
    delete aiWaits[key];
    renderAIWait();
  }

  function clearAIWaits() {
    aiWaits = {};
    renderAIWait();
  }

  function invalidateTurnFlow() {
    flowSerial++;
    currentRun = null;
    flowTimers.forEach(function (timer) { clearTimeout(timer); });
    flowTimers = [];
  }

  function startTurnRun() {
    currentRun = { id: ++flowSerial, matchId: matchId, turn: game.turn };
    return currentRun;
  }

  function isCurrentRun(run) {
    return !!(run && currentRun && run.id === currentRun.id &&
      run.matchId === matchId && run.turn === currentRun.turn);
  }

  function scheduleRun(run, fn, delay) {
    var timer = setTimeout(function () {
      flowTimers = flowTimers.filter(function (id) { return id !== timer; });
      if (isCurrentRun(run)) fn();
    }, delay);
    flowTimers.push(timer);
    return timer;
  }

  function syncControls() {
    var app = $('app');
    if (!app) return;
    var locked = interactionLocked();
    app.classList.toggle('turn-locked', locked);
    app.classList.toggle('ai-thinking-active', !!Object.keys(aiWaits).length);
    app.setAttribute('aria-busy', locked ? 'true' : 'false');
    [].forEach.call(document.querySelectorAll('.tool'), function (button) { button.disabled = locked; });
    if ($('btn-boost')) $('btn-boost').disabled = locked || !game || !!game.over || queuedBoosts() >= tokenCount(1);
    if ($('btn-clear')) $('btn-clear').disabled = locked || !orders.length || !!(game && game.over);
    if ($('btn-end')) $('btn-end').disabled = locked || !game || !!game.over || orders.length !== E.FIELD_COMMANDS;
    if ($('btn-tutorial')) $('btn-tutorial').disabled = locked;
    [].forEach.call(document.querySelectorAll('#tab-console input,#tab-console select,#tab-console button'), function (control) {
      control.disabled = locked;
    });
  }

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
    var active = false;
    var slides = [].slice.call(el.querySelectorAll('.slide'));
    var labels = [
      'THREE COMMANDS <kbd>→</kbd>', 'RAID &amp; GUARD <kbd>→</kbd>',
      'READ THE AIs <kbd>→</kbd>', 'TAKE THE RING <kbd>⏎</kbd>'
    ];

    CF.intro.init($('introcanvas'));

    function go(n) {
      slide = U.clamp(n, 0, slides.length - 1);
      slides.forEach(function (s) {
        s.classList.toggle('active', +s.dataset.slide === slide);
        s.setAttribute('aria-hidden', +s.dataset.slide === slide ? 'false' : 'true');
        if (+s.dataset.slide === slide) s.scrollTop = 0;
      });
      [].forEach.call(el.querySelectorAll('.dot-nav'), function (d, i) {
        d.classList.toggle('active', i === slide);
        if (i === slide) d.setAttribute('aria-current', 'step');
        else d.removeAttribute('aria-current');
      });
      $('intro-back').disabled = slide === 0;
      $('intro-progress').textContent = (slide + 1) + ' OF ' + slides.length;
      $('intro-next').innerHTML = labels[slide];
      if (CF.intro.setScene) CF.intro.setScene(slide);
    }

    function dismiss() {
      if (!active || el.classList.contains('leaving')) return;
      el.classList.add('leaving');
      setTimeout(function () {
        el.classList.add('hidden');
        el.classList.remove('leaving');
        CF.intro.stop();
        R.resize();
      }, 550);
      active = false;
      document.removeEventListener('keydown', keys, true);
    }

    function openIntro() {
      if (active || interactionLocked()) return;
      active = true;
      el.classList.remove('hidden', 'leaving');
      CF.intro.start();
      document.addEventListener('keydown', keys, true);
      go(0);
    }

    function keys(e) {
      // swallow everything: 1/2/3 and Enter must not reach the map below
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(slide + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(slide - 1); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (slide >= slides.length - 1) dismiss(); else go(slide + 1);
      }
    }

    $('intro-next').onclick = function () { if (slide >= slides.length - 1) dismiss(); else go(slide + 1); };
    $('intro-back').onclick = function () { go(slide - 1); };
    $('intro-skip').onclick = dismiss;
    $('btn-tutorial').onclick = openIntro;
    [].forEach.call(el.querySelectorAll('.dot-nav'), function (d) {
      d.onclick = function () { go(+d.dataset.go); };
    });

    openIntro();
  }

  function newGame(seed) {
    invalidateTurnFlow();
    busy = false;
    clearAIWaits();
    game = E.newGame(seed);
    lastBotMood = '—';
    lastBotEffort = null;
    matchId = 'ring-' + seed + '-' + (++matchSerial);
    profileSaved = false;
    directorAudit = null;
    saltkinAI = {
      doctrine: null,
      decision: null,
      cards: [],
      source: 'FALLBACK',
      model: null,
      latencyMs: 0,
      requestId: null,
      error: null,
      pending: false,
      requestSeq: 0,
      lastRequestTurn: 0,
      issuedTurn: 0,
      uses: 0,
      landAtIssue: E.landCount(game, 2),
      beaconAtIssue: game.tiles[game.beacon].owner,
      seasonAtIssue: 0,
      eventsAtIssue: 0
    };
    orders = []; boostNext = false; tool = 'expand';
    R.setState(game);
    R.setPreview([]);
    $('gameover').classList.add('hidden');
    $('warnbar').classList.add('hidden');
    say('world', 'A ring of islands, and a mountain under them that has never once sat still.');
    say('', 'The Ashfarers hold the west. The Saltkin hold the east. Seal two commands: Expand, Raid or Guard.');
    say('beacon', 'Hold the Beacon for 1 point each turn. First to ' + E.BEACON_TO_WIN + ' wins.');
    setTool('expand');
    renderFeed();
    refresh();
    var healthMatch = matchId;
    CF.ai.health().then(function (health) {
      if (!game || healthMatch !== matchId) return;
      aiHealth = health;
      CF.ai.configure(health);
      refresh();
      requestDoctrine('match_start');
    });
  }

  // ========================================================= Saltkin AI
  function strategyCards(payload) {
    var cards = payload && (payload.candidates || payload.strategy_cards || payload.strategyCards);
    if (!Array.isArray(cards) && payload && payload.publicState)
      cards = payload.publicState.strategy_cards || payload.publicState.strategyCards;
    return Array.isArray(cards) ? cards.filter(function (card) {
      return card && card.id && card.intent && card.region;
    }).slice(0, 3) : [];
  }

  function trustedStrategyCard(cards, decision) {
    var selected = decision && decision.selected_candidate;
    for (var i = 0; i < cards.length; i++) if (cards[i].id === selected) return cards[i];
    return null;
  }

  function requestDoctrine(reason) {
    if (!game || game.over || interactionLocked() || orders.length || saltkinAI.pending ||
        saltkinAI.lastRequestTurn === game.turn) return;
    var requestMatch = matchId, snapshotTurn = game.turn;
    var seq = ++saltkinAI.requestSeq;
    var payload = CF.profile.requestPayload(game, requestMatch);
    payload.trigger = reason;
    saltkinAI.cards = strategyCards(payload);
    saltkinAI.pending = true;
    saltkinAI.lastRequestTurn = snapshotTurn;
    saltkinAI.error = null;
    beginAIWait('doctrine', 'doctrine');
    refresh();

    CF.ai.saltkin(payload).then(function (response) {
      if (!game || requestMatch !== matchId || snapshotTurn !== game.turn || busy ||
          seq !== saltkinAI.requestSeq || response.matchId !== requestMatch || response.snapshotTurn !== snapshotTurn) {
        if (requestMatch === matchId && seq === saltkinAI.requestSeq) {
          saltkinAI.pending = false;
          saltkinAI.error = 'late_response_discarded';
          endAIWait('doctrine');
          refresh();
        }
        return;
      }
      saltkinAI.pending = false;
      var chosenCard = typeof CF.profile.resolveStrategyCard === 'function'
        ? CF.profile.resolveStrategyCard(payload, response.decision)
        : trustedStrategyCard(saltkinAI.cards, response.decision);
      if (!chosenCard) {
        saltkinAI.pending = false;
        saltkinAI.doctrine = null;
        saltkinAI.decision = response.decision || null;
        saltkinAI.source = 'FALLBACK';
        saltkinAI.error = 'untrusted_strategy_card';
        say('b', 'Saltkin AI returned no trusted strategy card. Deterministic strategy takes over.');
        updateAIWait('doctrine', {
          fallback: true,
          title: 'Untrusted card refused',
          detail: 'Only one of the three program-generated strategy cards may be selected.',
          footer: 'Fallback is explicit; the rules remain authoritative.'
        });
        renderFeed();
        refresh();
        setTimeout(function () {
          if (requestMatch === matchId && seq === saltkinAI.requestSeq) endAIWait('doctrine');
        }, 650);
        return;
      }
      saltkinAI.doctrine = chosenCard;
      saltkinAI.decision = response.decision;
      saltkinAI.source = response.meta.source || 'LLM';
      saltkinAI.model = response.meta.model || null;
      saltkinAI.latencyMs = response.meta.latencyMs || 0;
      saltkinAI.requestId = response.meta.requestId || null;
      saltkinAI.error = null;
      saltkinAI.issuedTurn = snapshotTurn;
      saltkinAI.uses = 0;
      saltkinAI.landAtIssue = E.landCount(game, 2);
      saltkinAI.beaconAtIssue = game.tiles[game.beacon].owner;
      saltkinAI.seasonAtIssue = game.season;
      saltkinAI.eventsAtIssue = game.targetHistory.length;
      say('b', 'Saltkin intent: ' + chosenCard.intent + ' · ' + chosenCard.region + '.');
      endAIWait('doctrine');
      renderFeed();
      refresh();
    }).catch(function (err) {
      if (requestMatch !== matchId || seq !== saltkinAI.requestSeq) return;
      saltkinAI.pending = false;
      saltkinAI.doctrine = null;
      saltkinAI.decision = null;
      saltkinAI.uses = 0;
      saltkinAI.source = 'FALLBACK';
      saltkinAI.error = (err && err.code) || 'request_failed';
      say('b', 'Saltkin AI fallback (' + saltkinAI.error + '). Deterministic strategy remains active.');
      updateAIWait('doctrine', {
        fallback: true,
        title: 'Signal lost — fallback card takes over',
        detail: 'The deterministic Saltkin commander will continue without hidden advantages.',
        footer: 'Fallback is explicit; the turn remains reproducible.'
      });
      renderFeed();
      refresh();
      setTimeout(function () {
        if (requestMatch === matchId && seq === saltkinAI.requestSeq) endAIWait('doctrine');
      }, 650);
    });
  }

  function maybeRequestDoctrine() {
    if (!game || game.over) return;
    var lostLand = saltkinAI.landAtIssue - E.landCount(game, 2);
    var beaconChanged = game.tiles[game.beacon].owner !== saltkinAI.beaconAtIssue;
    var worldChanged = game.targetHistory.length > saltkinAI.eventsAtIssue;
    if (CF.profile.shouldRequestDoctrine({
      pending: saltkinAI.pending,
      lastRequestTurn: saltkinAI.lastRequestTurn,
      turn: game.turn,
      hasDoctrine: !!saltkinAI.doctrine,
      uses: saltkinAI.uses,
      lostLand: lostLand,
      beaconChanged: beaconChanged,
      worldChanged: worldChanged
    }))
      requestDoctrine(lostLand >= 3 ? 'lost_land' : beaconChanged ? 'beacon_changed' : worldChanged ? 'world_event' : 'doctrine_expired');
  }

  // ============================================================== ordering
  function tokenCount(side) {
    return game && game.tokens ? Number(game.tokens[side] || 0) : 0;
  }

  function queuedBoosts() {
    return orders.filter(function (order) { return !!order.boosted; }).length;
  }

  function fieldPreview(extra) {
    var plan = extra ? orders.concat(extra) : orders;
    if (typeof E.commandPreview === 'function') return E.commandPreview(game, 1, plan);
    return { ok: plan.length <= E.FIELD_COMMANDS, commands: plan.length,
      reason: 'Only ' + E.FIELD_COMMANDS + ' commands may be queued.' };
  }

  function fieldSpent() {
    return fieldPreview().commands;
  }

  function rejectOrder(i, message) {
    say('', message);
    renderFeed();
    if (i != null) R.push([{ kind: 'invalid', at: i }]);
  }

  function tryOrder(i) {
    if (interactionLocked() || game.over) return;
    if (orders.length >= E.FIELD_COMMANDS) {
      rejectOrder(i, 'Both secret command slots are filled. Remove one to change the plan.');
      return;
    }
    var from = null;
    if (tool === 'expand') {
      if (orders.some(function (o) { return o.type === 'expand' && o.to === i; })) { rejectOrder(i, 'Already claiming that square.'); return; }
      from = E.canExpand(game, 1, i, orders);
      if (from == null) { rejectOrder(i, 'You can only settle empty land next to ground you already hold.'); return; }
    } else if (tool === 'guard') {
      if (orders.some(function (o) { return o.type === 'guard' && o.to === i; })) {
        rejectOrder(i, 'A square can be guarded only once per turn.');
        return;
      }
      from = E.canGuard(game, 1, i);
      if (from == null) {
        rejectOrder(i, 'Guard a square you already hold.');
        return;
      }
    } else {
      var used = orders.filter(function (o) { return o.type === 'raid' && o.to === i; })
        .map(function (o) { return o.from; });
      from = E.canRaid(game, 1, i, used);
      if (from == null) {
        rejectOrder(i, used.length ? 'A coordinated Raid needs another distinct adjacent source square.'
          : 'Raid an enemy square that touches your own.');
        return;
      }
    }

    var candidate = { type: tool, to: i, from: from };
    var command = fieldPreview(candidate);
    if (!command.ok) {
      rejectOrder(i, command.reason);
      return;
    }
    orders.push(candidate);
    refresh();
  }

  function removeOrder(k) {
    if (interactionLocked()) return;
    orders.splice(k, 1);
    refresh();
  }

  function toggleBoostNext() {
    if (interactionLocked() || !game || game.over) return;
    if (!boostNext && queuedBoosts() >= tokenCount(1)) {
      say('', 'No uncommitted supply token is available. Remove a ◆ from another command first.');
      renderFeed();
      return;
    }
    boostNext = !boostNext;
    refresh();
  }

  function toggleOrderBoost(k) {
    if (interactionLocked() || !game || game.over || !orders[k]) return;
    if (!orders[k].boosted && queuedBoosts() >= tokenCount(1)) {
      say('', 'Both available supply tokens are already committed.');
      renderFeed();
      return;
    }
    orders[k].boosted = !orders[k].boosted;
    refresh();
  }

  // =========================================================== turn cycle
  function endTurn() {
    if (interactionLocked() || game.over) return;
    if (orders.length !== E.FIELD_COMMANDS) {
      say('', 'Seal exactly ' + E.FIELD_COMMANDS + ' commands before resolving the turn.');
      renderFeed();
      return;
    }
    busy = true;
    var run = startTurnRun();
    beginAIWait('orders', 'orders');
    refresh();
    scheduleRun(run, function () { resolveOrders(run); }, 420);
  }

  function resolveOrders(run) {
    if (!isCurrentRun(run)) return;
    var plan = CF.bot.plan(game, 2, forceTurtle, saltkinAI.doctrine);
    lastBotMood = plan.mood;
    lastBotEffort = plan.card || plan.strategy || plan.effort || null;
    if (saltkinAI.doctrine) saltkinAI.uses++;

    var res = E.resolveTurn(game, orders, plan.orders);
    game = res.state;
    orders = [];
    boostNext = false;
    R.setState(game);
    R.setPreview([]);
    R.push(res.fx);
    renderFeed();
    refresh();
    updateAIWait('orders', {
      detail: 'Orders sealed · resolving both command envelopes together.',
      footer: 'No side sees the other side’s current queue.'
    });
    scheduleRun(run, function () { phaseEvent(run); }, 620);
  }

  function phaseEvent(run) {
    if (!isCurrentRun(run)) return;
    endAIWait('orders');
    var p = game.pending;
    if (game.over) { phaseDirector(run); return; }
    if (EV.isDue(p, game.turn) && !paused) {
      fireEvent(p);
      scheduleRun(run, function () { phaseDirector(run); }, 1700);
    } else {
      if (p && paused) say('world', 'Director paused. ' + EV.nameOf(p.template) + ' is held at the gate.');
      phaseDirector(run);
    }
  }

  function phaseDirector(run) {
    if (!isCurrentRun(run)) return;
    var limitReached = game.stats.length >= E.MAX_TURNS;
    if (!game.over && !limitReached && game.turn % 2 === 0 && game.turn < E.MAX_TURNS && !paused) {
      beginAIWait('director', 'director');
      scheduleRun(run, function () { requestDirector(run); }, 260);
      return;
    }

    finalizeTurn(run);
  }

  function requestDirector(run) {
    if (!isCurrentRun(run)) return;
    // Mark the previous prediction right or wrong before choosing again.
    game.chronicle.forEach(function (c) { if (c.fired) D.scorePrediction(game, c); });
    var prepared;
    try {
      prepared = D.prepare(game, saltkinAI.doctrine);
      directorAudit = { prepared: prepared, source: 'PENDING', error: null };
      updateAIWait('director', {
        detail: 'Testing ' + prepared.candidates.length + ' safe candidate' +
          (prepared.candidates.length === 1 ? '' : 's') + ' against the live map.'
      });
      refresh();
    } catch (err) {
      var immediate = null;
      try { immediate = D.decide(game); } catch (fallbackErr) { immediate = null; }
      if (immediate) {
        immediate.source = 'FALLBACK';
        immediate.reasoning = 'Source: FALLBACK · counterfactual_error\n\n' + immediate.reasoning;
      }
      directorAudit = { prepared: null, source: 'FALLBACK', error: 'counterfactual_error' };
      finishDirector(run, immediate, immediate
        ? 'Counterfactual table unavailable — safe baseline selected.'
        : 'No safe world change is available — Cinder leaves the map unchanged this season.');
      return;
    }

    if (prepared.candidates.length < 3) {
      var emptyFallback = prepared.baseline;
      directorAudit.source = 'FALLBACK';
      directorAudit.error = emptyFallback ? 'insufficient_distinct_candidates' : 'no_safe_candidates';
      if (emptyFallback) {
        emptyFallback.source = 'FALLBACK';
        emptyFallback.reasoning = 'Source: FALLBACK · insufficient_distinct_candidates\n\n' + emptyFallback.reasoning;
      }
      finishDirector(run, emptyFallback, emptyFallback
        ? 'Fewer than three distinct safe choices remain — deterministic safe baseline selected.'
        : 'No safe world change remains — Cinder leaves the map unchanged this season.');
      return;
    }

    CF.ai.director(prepared.payload).then(function (response) {
      if (!isCurrentRun(run)) return;
      if (response.season !== prepared.report.season) {
        directorFallback(run, prepared, { code: 'season_mismatch' });
        return;
      }
      var ev;
      try { ev = D.fromLLM(game, prepared, response.decision, response.meta); }
      catch (err) { directorFallback(run, prepared, err); return; }
      if (!ev) { directorFallback(run, prepared, { code: 'unknown_candidate' }); return; }
      directorAudit.source = 'LLM';
      directorAudit.meta = response.meta;
      finishDirector(run, ev);
    }, function (err) { directorFallback(run, prepared, err); });
  }

  function directorFallback(run, prepared, err) {
    if (!isCurrentRun(run)) return;
    var ev = prepared.baseline;
    var code = (err && (err.code || err.message)) || 'request_failed';
    ev.source = 'FALLBACK';
    ev.model = null;
    ev.latencyMs = 0;
    ev.requestId = null;
    ev.candidateAudit = prepared.payload.candidates;
    ev.shadowBaseline = { template: ev.template, intensity: ev.intensity, region: ev.region };
    ev.reasoning = 'Source: FALLBACK · ' + code + '\n\n' + ev.reasoning;
    directorAudit.source = 'FALLBACK';
    directorAudit.error = code;
    finishDirector(run, ev, 'Signal lost — deterministic safe baseline takes over.');
  }

  function finishDirector(run, ev, fallbackMessage) {
    if (!isCurrentRun(run)) return;
    function commit() {
      if (!isCurrentRun(run)) return;
      endAIWait('director');
      if (ev) queueDirectorEvent(ev);
      finalizeTurn(run);
    }
    if (fallbackMessage) {
      updateAIWait('director', {
        fallback: true,
        title: 'Cinder falls back safely',
        detail: fallbackMessage,
        footer: 'The deterministic validator remains authoritative.'
      });
      scheduleRun(run, commit, 650);
    } else commit();
  }

  function queueDirectorEvent(ev) {
    game.season = ev.season;
    game.pending = ev;
    game.chronicle.push({
      season: ev.season, decidedTurn: game.turn, fireTurn: ev.fireTurn,
      template: ev.template, intensity: ev.intensity, region: ev.region,
      warning: ev.warning, reasoning: ev.reasoning, report: ev.report,
      prediction: ev.prediction, predictionResult: 'pending',
      message: null, fired: false, measured: null, mainTarget: ev.mainTarget,
      source: ev.source || 'FALLBACK', model: ev.model || null,
      latencyMs: ev.latencyMs || 0, requestId: ev.requestId || null,
      goal: ev.goal || null, confidence: ev.confidence == null ? null : ev.confidence,
      evidenceUsed: ev.evidenceUsed || [], shadowBaseline: ev.shadowBaseline || null,
      candidateAudit: ev.candidateAudit || []
    });
    say('world', 'Cinder stirs. ' + ev.warning);
  }

  function finalizeTurn(run) {
    if (!isCurrentRun(run)) return;
    if (!game.over) game.over = E.checkVictory(game);
    if (!game.over) game.turn += 1;

    busy = false;
    currentRun = null;
    endAIWait('orders');
    endAIWait('director');
    R.setState(game);
    renderFeed();
    refresh();
    if (game.over) showGameOver();
    else maybeRequestDoctrine();
  }

  function fireEvent(ev) {
    // Validate again against the live board. A warned event was safe when it
    // was proposed, but the intervening player turn may have changed that.
    var guard = CF.validator.check(game, ev);
    if (!guard.ok) {
      var replacement = D.recoverEvent(game, ev, guard.fails);
      if (replacement) {
        say('world', EV.nameOf(ev.template) + ' failed its live check; Cinder switched to ' + EV.nameOf(replacement.template) + '.');
        var recovered = game.chronicle.filter(function (c) { return c.season === ev.season; })[0];
        if (recovered) {
          recovered.template = replacement.template;
          recovered.intensity = replacement.intensity;
          recovered.region = replacement.region;
          recovered.warning = replacement.warning;
          recovered.reasoning = replacement.reasoning;
          recovered.mainTarget = replacement.mainTarget;
          recovered.source = 'FALLBACK';
        }
        game.pending = replacement;
        return fireEvent(replacement);
      }
      say('world', EV.nameOf(ev.template) + ' was refused at the gate — ' + guard.fails.join('; ') + '.');
      var refused = game.chronicle.filter(function (c) { return c.season === ev.season; })[0];
      if (refused) {
        refused.message = 'Refused at execution: ' + guard.fails.join('; ');
        refused.predictionResult = 'refused';
        refused.reasoning += '\n\nExecution guardrails: refused — ' + guard.fails.join('; ') + '.';
      }
      game.pending = null;
      renderFeed();
      refresh();
      return false;
    }

    var out = EV.apply(game, ev);
    if (!out.ok) {
      say('world', 'The mountain rumbled and thought better of it.');
      game.pending = null;
      return false;
    }
    game = out.state;
    game.pending = null;
    game.lastTemplate = ev.template;
    ev.mainTarget = guard.mainTarget || 0;
    game.targetHistory.push(ev.mainTarget);
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
    return true;
  }

  // ================================================================== UI
  function setTool(t) {
    if (interactionLocked()) return;
    tool = t;
    [].forEach.call(document.querySelectorAll('.tool'), function (b) {
      b.classList.toggle('active', b.dataset.tool === t);
      b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false');
    });
    if (game) refresh();
  }

  function legalTargetsForTool() {
    if (!game || game.over || interactionLocked()) return [];
    if (orders.length >= E.FIELD_COMMANDS) return [];
    var result = [];
    for (var i = 0; i < game.tiles.length; i++) {
      var from = null, special = false;
      if (tool === 'expand') {
        if (orders.some(function (o) { return o.type === 'expand' && o.to === i; })) continue;
        from = E.canExpand(game, 1, i, orders);
      } else if (tool === 'guard') {
        if (orders.some(function (o) { return o.type === 'guard' && o.to === i; })) continue;
        from = E.canGuard(game, 1, i);
      } else {
        var used = orders.filter(function (o) { return o.type === 'raid' && o.to === i; })
          .map(function (o) { return o.from; });
        from = E.canRaid(game, 1, i, used);
        special = used.length > 0 && from != null;
      }
      if (from == null) continue;
      var candidate = { type: tool, to: i, from: from };
      var plan = fieldPreview(candidate);
      if (plan.ok) result.push({ i: i, special: special });
    }
    return result;
  }

  function refresh() {
    if (!game) return;
    var tokens = 0, committed = 0;

    $('hud-turn').textContent = Math.min(game.turn, E.MAX_TURNS);
    $('hud-season').textContent = game.season;
    $('hud-a-land').textContent = E.suppliedLandCount(game, 1);
    $('hud-b-land').textContent = E.suppliedLandCount(game, 2);
    $('hud-a-bp').style.width = Math.min(100, game.bp[1] / E.BEACON_TO_WIN * 100) + '%';
    $('hud-b-bp').style.width = Math.min(100, game.bp[2] / E.BEACON_TO_WIN * 100) + '%';
    $('hud-a-bplabel').textContent = game.bp[1] + ' / ' + E.BEACON_TO_WIN;
    $('hud-b-bplabel').textContent = game.bp[2] + ' / ' + E.BEACON_TO_WIN;

    $('hud-tokens').textContent = '—';
    [].forEach.call($('hud-token-pips').querySelectorAll('i'), function (pip, index) {
      pip.classList.toggle('full', index < tokens - committed);
      pip.classList.toggle('committed', index >= tokens - committed && index < tokens);
    });
    $('hud-command-used').textContent = fieldSpent();
    $('hud-command-left').textContent = Math.max(0, E.FIELD_COMMANDS - fieldSpent());

    renderOrders();
    renderBoost();
    renderPlayerEffort();
    renderMods();
    renderWarning();
    renderChronicle();
    renderConsole();
    R.setPreview(orders);
    R.setLegalTargets(legalTargetsForTool(), tool);
    $('btn-end-label').textContent = orders.length === E.FIELD_COMMANDS
      ? 'SEAL & RESOLVE 2 COMMANDS'
      : 'QUEUE ' + (E.FIELD_COMMANDS - orders.length) + ' MORE COMMAND' +
        (E.FIELD_COMMANDS - orders.length === 1 ? '' : 'S');
    syncControls();
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
      var icon = o.type === 'expand' ? '✚' : o.type === 'guard' ? '◇' : '⚔';
      var label = o.type === 'raid'
        ? E.coord(game, o.from) + ' → ' + E.coord(game, o.to)
        : E.coord(game, o.to);
      li.innerHTML = '<span class="oi">' + icon + '</span><span>' + U.cap(o.type) + ' ' + label +
                     '</span><button class="order-remove" type="button" aria-label="Remove ' + U.cap(o.type) +
                     ' order at ' + E.coord(game, o.to) + '">×</button>';
      li.querySelector('.order-remove').onclick = function () { removeOrder(k); };
      ul.appendChild(li);
    });
  }

  function renderBoost() {
    $('btn-boost').classList.add('hidden');
  }

  function renderPlayerEffort() {
    var el = $('player-effort');
    var focusedRaid = orders.length === 2 && orders.every(function (o) { return o.type === 'raid'; }) &&
      orders[0].to === orders[1].to;
    var chain = orders.length === 2 && orders.every(function (o) { return o.type === 'expand'; }) &&
      orders[1].from === orders[0].to;
    el.classList.remove('redeploy');
    el.textContent = focusedRaid ? 'FOCUSED RAID · BREAKS ONE GUARD'
      : chain ? 'CONCENTRATED OPERATION · TWO-TILE ADVANCE'
      : 'ISSUE EXACTLY TWO COMMANDS · ' + orders.length + ' / 2 SEALED';
  }

  function renderMods() {
    var box = $('modlist');
    box.innerHTML = '';
    function tag(txt) { var d = document.createElement('div'); d.className = 'mod'; d.textContent = txt; box.appendChild(d); }
    if (game.pending && game.pending.affected && game.pending.affected.length)
      tag('BEACON MOVES TO ' + E.coord(game, game.pending.affected[0]));
  }

  function renderWarning() {
    var bar = $('warnbar'), p = game.pending;
    if (!p) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    $('warn-title').textContent = 'WARNING · ' + EV.nameOf(p.template) + ' · INTENSITY ' + 'I'.repeat(p.intensity);
    var exact = Array.isArray(p.affected) && p.affected.length
      ? p.affected.map(function (i) { return E.coord(game, i); }).join(', ')
      : (p.region ? EV.regionName(p.region).toUpperCase() : 'MARKED TILES');
    $('warn-sub').textContent = 'EXACT TILES · ' + exact + ' · ' + p.warning;
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
    var overlay = $('gameover');
    var aLand = E.landCount(game, 1), bLand = E.landCount(game, 2);
    $('go-a-bp').textContent = game.bp[1];
    $('go-b-bp').textContent = game.bp[2];
    $('go-a-land').textContent = aLand;
    $('go-b-land').textContent = bLand;
    $('go-kicker').textContent = game.stats.length >= E.MAX_TURNS
      ? 'FINAL RECKONING · TURN ' + E.MAX_TURNS
      : 'DECISIVE VICTORY · TURN ' + game.stats.length;
    $('go-verdict').textContent = /capital/i.test(o.why) ? 'CAPITAL CAPTURE'
      : game.bp[1] !== game.bp[2] ? 'BEACON SCORE'
      : aLand !== bLand ? 'TERRITORY TIE-BREAK' : 'THE RING REMAINS EVEN';
    $('go-title').textContent = o.winner === 0 ? 'A DRAWN RING'
      : o.winner === 1 ? 'THE ASHFARERS HOLD' : 'THE SALTKIN HOLD';
    $('go-sub').textContent = o.why;
    overlay.classList.remove('winner-a', 'winner-b', 'winner-draw', 'settling');
    overlay.classList.add(o.winner === 1 ? 'winner-a' : o.winner === 2 ? 'winner-b' : 'winner-draw');
    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('settling');
    if (!profileSaved) {
      CF.profile.completeMatch(game);
      profileSaved = true;
    }
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
              : c.predictionResult === 'refused' ? '<span class="tag miss">EVENT REFUSED</span>'
              : '<span class="tag wait">NOT YET MEASURED</span>';

      d.innerHTML =
        '<div class="ch-top">' +
          '<span class="ch-season">SEASON ' + c.season + ' · TURN ' + c.fireTurn + ' · ' + (c.source || 'FALLBACK') + '</span>' +
          '<span class="ch-int">' + 'I'.repeat(c.intensity) + '</span>' +
          '<span class="ch-name">' + EV.nameOf(c.template) + '</span>' +
        '</div>' +
        '<div class="ch-body">' +
          '<div class="ch-msg"></div>' +
          '<div class="ch-why"></div>' +
          '<div class="ch-pred">' + tag + '<span class="pred-text"></span></div>' +
        '</div>';

      d.querySelector('.ch-msg').textContent = c.fired ? '“' + c.message + '”'
        : c.predictionResult === 'refused' ? '(' + c.message + ')'
        : '(warned, not yet fired) ' + c.warning;
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

    var healthLine = 'SERVER ' + (aiHealth.ready ? 'READY' : 'FALLBACK') +
      ' · ' + (aiHealth.model || 'openai/gpt-oss-120b') +
      (aiHealth.reason ? ' · ' + aiHealth.reason : '');
    var saltkinLine = 'SALTKIN ' + (saltkinAI.pending ? 'PENDING' : saltkinAI.source) +
      (saltkinAI.error ? ' · ' + saltkinAI.error : '') +
      (saltkinAI.latencyMs ? ' · ' + saltkinAI.latencyMs + 'ms' : '');
    var directorLine = 'DIRECTOR ' + (directorAudit ? directorAudit.source : 'SLEEPING') +
      (directorAudit && directorAudit.error ? ' · ' + directorAudit.error : '');
    $('con-ai-status').textContent = [healthLine, saltkinLine, directorLine].join('\n');
    $('con-ai-status').classList.toggle('fallback', !aiHealth.ready || saltkinAI.source === 'FALLBACK' ||
      (directorAudit && directorAudit.source === 'FALLBACK'));

    var doctrineText = saltkinAI.doctrine ? JSON.stringify({
      selected_card: saltkinAI.doctrine,
      evidence_used: saltkinAI.decision && saltkinAI.decision.evidence_used || [],
      explanation: saltkinAI.decision && saltkinAI.decision.explanation || ''
    }, null, 2) : 'deterministic fallback card';
    $('con-doctrine').textContent = doctrineText + '\n\nsource=' + saltkinAI.source +
      ' · used=' + saltkinAI.uses + '/2' + (saltkinAI.requestId ? ' · request=' + saltkinAI.requestId : '');
    var playerProfile = CF.profile.build(game, CF.profile.load());
    $('con-profile').textContent = JSON.stringify(playerProfile.features, null, 2) +
      '\n\nEVIDENCE\n' + JSON.stringify(playerProfile.evidence, null, 2);
    var card = saltkinAI.doctrine || lastBotEffort;
    var cardText = card && (card.intent || card.posture)
      ? (card.intent || card.posture) + ' · ' + (card.region || card.front || 'BEACON') : String(lastBotMood || 'BALANCED').toUpperCase();
    $('saltkin-intent').textContent = saltkinAI.doctrine
      ? 'SALTKIN AI · ' + cardText + ' · FOR 2 TURNS'
      : 'SALTKIN AI · FALLBACK · ' + cardText;

    if (!directorAudit || !directorAudit.prepared) {
      $('con-candidates').textContent = 'no season evaluated yet';
    } else {
      var prepared = directorAudit.prepared;
      var candidateLines = prepared.candidates.map(function (c) {
        return c.id + ' · ' + EV.nameOf(c.event.template) + ' · ' +
          E.coord(game, c.event.affected[0]) + ' · ' + c.event.region.toUpperCase();
      });
      candidateLines.push('');
      candidateLines.push('SHADOW · ' + EV.nameOf(prepared.baseline.template) + ' I'.repeat(prepared.baseline.intensity) +
        ' ' + prepared.baseline.region.toUpperCase());
      $('con-candidates').textContent = candidateLines.join('\n');
    }

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
      var point = R.pointFromClient(e.clientX, e.clientY);
      var i = R.tileAt(point.x, point.y);
      R.setHover(i);
      showTooltip(i, e.clientX, e.clientY);
    });
    cv.addEventListener('mouseleave', function () { R.setHover(-1); $('tooltip').classList.add('hidden'); });
    cv.addEventListener('click', function (e) {
      var point = R.pointFromClient(e.clientX, e.clientY);
      var i = R.tileAt(point.x, point.y);
      if (i >= 0) tryOrder(i);
    });
    cv.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var point = R.pointFromClient(e.clientX, e.clientY);
      var i = R.tileAt(point.x, point.y);
      for (var k = orders.length - 1; k >= 0; k--) if (orders[k].to === i) { removeOrder(k); return; }
    });

    [].forEach.call(document.querySelectorAll('.tool'), function (b) {
      b.onclick = function () { setTool(b.dataset.tool); };
    });
    [].forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.onclick = function () {
        [].forEach.call(document.querySelectorAll('.tab'), function (x) {
          x.classList.remove('active');
          x.setAttribute('aria-selected', 'false');
        });
        [].forEach.call(document.querySelectorAll('.panel'), function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        b.setAttribute('aria-selected', 'true');
        $('tab-' + b.dataset.tab).classList.add('active');
      };
    });

    $('btn-end').onclick = endTurn;
    $('btn-boost').onclick = toggleBoostNext;
    $('btn-clear').onclick = function () {
      if (interactionLocked()) return;
      orders = []; boostNext = false; refresh();
    };
    $('go-again').onclick = function () { if (!interactionLocked()) newGame((Math.random() * 1e9) | 0); };
    $('con-new').onclick = function () { if (!interactionLocked()) newGame((Math.random() * 1e9) | 0); };

    $('con-pause').onchange = function () {
      if (interactionLocked()) return;
      paused = this.checked;
      say('world', paused ? 'Director paused by the designer.' : 'Director resumed.');
      // Release an overdue event before the next player action. If a turn is
      // already resolving, its scheduled event phase will do the same check.
      if (!paused && !busy && !game.over && EV.isDue(game.pending, game.turn))
        fireEvent(game.pending);
      renderFeed();
    };
    $('con-turtle').onchange = function () {
      if (interactionLocked()) return;
      forceTurtle = this.checked;
      say('world', forceTurtle
        ? 'Rival forced to turtle. Sit still and watch what the mountain does about it.'
        : 'Rival returned to its own judgement.');
      renderFeed();
    };
    $('con-ai-fail').onchange = function () {
      if (interactionLocked()) return;
      CF.ai.setFailure(this.checked);
      say('world', this.checked ? 'AI failure simulation enabled. Requests will time out into explicit fallback.'
        : 'AI failure simulation disabled.');
      renderFeed();
      refresh();
    };
    $('con-clear-memory').onclick = function () {
      if (interactionLocked()) return;
      CF.profile.clear();
      say('world', 'Adaptive player memory cleared. No identity data was stored.');
      renderFeed();
      refresh();
    };

    // template picker for the override
    var sel = $('con-override');
    EV.all().forEach(function (id) {
      var o = document.createElement('option');
      o.value = id; o.textContent = EV.nameOf(id);
      sel.appendChild(o);
    });

    $('con-apply').onclick = function () {
      if (interactionLocked()) return;
      var ev = {
        template: sel.value,
        intensity: +$('con-intensity').value,
        region: game.pending ? game.pending.region : 'centre',
        prediction: { metric: 'raids', dir: 'up', mag: 0.3, text: 'Chosen by a human. No prediction on record.' },
        season: game.pending ? game.pending.season : game.season + 1,
        fireTurn: game.pending ? game.pending.fireTurn : game.turn,
        mainTarget: 0
      };
      var approval = CF.validator.approveOverride(game, ev);
      if (!approval.ok) {
        say('world', 'Designer override refused — ' + approval.fails.join('; ') + '.');
        renderFeed();
        refresh();
        return;
      }
      ev = approval.ev || ev;
      ev.warning = EV.warningFor(ev);
      ev.reasoning = 'Overridden by the designer.\n\nGuardrails: passed.';
      ev.report = game.pending ? game.pending.report : '(no report — human override)';
      ev.mainTarget = approval.mainTarget || ev.mainTarget;

      if (game.pending) {
        game.pending = ev;
        var entry = game.chronicle[game.chronicle.length - 1];
        if (entry && !entry.fired) {
          entry.template = ev.template; entry.intensity = ev.intensity;
          entry.region = ev.region; entry.warning = ev.warning; entry.reasoning = ev.reasoning;
          entry.prediction = ev.prediction; entry.mainTarget = ev.mainTarget;
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
      if (interactionLocked()) return;
      if (!game.pending) { say('world', 'Nothing is queued. Pick a template and press override first.'); renderFeed(); return; }
      fireEvent(game.pending);
    };

    document.addEventListener('keydown', function (e) {
      var target = e.target;
      var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (interactionLocked() || e.repeat || e.isComposing ||
          /^(button|input|select|textarea)$/.test(tag) || (target && target.isContentEditable)) return;
      if (e.key === '1') setTool('expand');
      else if (e.key === '2') setTool('guard');
      else if (e.key === '3') setTool('raid');
      else if (e.key === 'Enter') endTurn();
      else if (e.key === 'Escape') { orders = []; boostNext = false; refresh(); }
    });
  }

  // --------------------------------------------------------------- tooltip
  function showTooltip(i, clientX, clientY) {
    var el = $('tooltip');
    if (i < 0 || !game.tiles[i]) { el.classList.add('hidden'); return; }
    var t = game.tiles[i];
    var name = E.coord(game, i);

    var rows = [];
    if (!t.land) {
      rows.push(['terrain', 'open water']);
    } else {
      rows.push(['holder', t.owner ? E.SIDE[t.owner] : 'nobody']);
      rows.push(['terrain', 'land']);
      if (t.capital) rows.push(['capital', 'requires 2 effective Raids']);
    }
    if (i === game.beacon) {
      rows.push(['', 'THE BEACON · OWNER SCORES']);
    }

    var hint = '';
    if (t.land) {
      if (tool === 'raid') {
        var used = orders.filter(function (o) { return o.type === 'raid' && o.to === i; })
          .map(function (o) { return o.from; });
        var src = E.canRaid(game, 1, i, used);
        if (src != null) {
          var count = used.length + 1;
          hint = count + (count === 1 ? ' Raid queued' : ' Raids queued') +
            (t.capital ? ' · capital needs 2 effective Raids' : ' · captures unless Guarded');
        }
      } else if (tool === 'expand') {
        var expandFrom = E.canExpand(game, 1, i, orders);
        if (expandFrom != null) {
          var chained = game.tiles[expandFrom].owner !== 1;
          hint = chained ? 'continue a two-step advance' : 'claim this neutral tile';
        }
      } else if (tool === 'guard') {
        if (E.canGuard(game, 1, i) != null) hint = 'cancel one Raid against this tile this turn';
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
    var wrapEl = $('canvas-wrap');
    var localScaleX = wrap.width ? wrapEl.offsetWidth / wrap.width : 1;
    var localScaleY = wrap.height ? wrapEl.offsetHeight / wrap.height : 1;
    var px = (clientX - wrap.left) * localScaleX - wrapEl.clientLeft;
    var py = (clientY - wrap.top) * localScaleY - wrapEl.clientTop;
    var x = px + 16, y = py + 16;
    if (x + w > wrapEl.clientWidth - 6) x = px - w - 16;
    if (y + h > wrapEl.clientHeight - 6) y = py - h - 16;
    el.style.left = Math.max(6, x) + 'px';
    el.style.top = Math.max(6, y) + 'px';
  }

  // expose for headless balance runs from the console
  window.CF.game = {
    get state() { return game; },
    get interactionLocked() { return interactionLocked(); },
    get thinking() { var wait = activeWait(); return wait ? wait.kind : null; },
    newGame: newGame,
    endTurn: endTurn
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
