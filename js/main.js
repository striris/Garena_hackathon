/* ============================================================
   main.js — wiring
   Turn flow, order queueing, the warning bar, the message feed,
   the chronicle and the designer console.
   ============================================================ */
(function () {
  var U = CF.util, E = CF.engine, EV = CF.events, R = CF.render, D = CF.director;

  var game = null;
  var orders = [];
  var supportRequested = false;
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
      stages: ['Tracing supplied routes.', 'Weighing NORTH against SOUTH.', 'Counting exposed Relays.', 'Writing a three-turn doctrine.']
    },
    orders: {
      kicker: 'SALTKIN COMMAND TENT', title: 'Sealing the rival orders',
      stages: ['Placing the first command stone.', 'Testing the secondary front.', 'Funding any operation support.', 'Both envelopes are now sealed.']
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
    if ($('btn-support')) $('btn-support').disabled = locked || !game || !E.supportType(game, 1, orders);
    if ($('btn-clear')) $('btn-clear').disabled = locked || !orders.length;
    if ($('btn-end')) $('btn-end').disabled = locked || !game || !!game.over;
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
      'READ THE RING <kbd>→</kbd>', 'FUND A TURN <kbd>→</kbd>',
      'COMMIT THE EFFORT <kbd>→</kbd>', 'BREAK AND CUT <kbd>→</kbd>',
      'CINDER AND VICTORY <kbd>→</kbd>', 'TAKE THE RING <kbd>⏎</kbd>'
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
    orders = []; supportRequested = false; tool = 'expand';
    R.setState(game);
    R.setPreview([]);
    $('gameover').classList.add('hidden');
    $('warnbar').classList.add('hidden');
    say('world', 'A ring of islands, and a mountain under them that has never once sat still.');
    say('', 'The Ashfarers hold the west. The Saltkin hold the east. Cinder wakes at the end of turn 3.');
    say('beacon', 'ASH SURGE: the ' + game.opening.route + ' route gains +1 supplied fertility through turn ' + game.opening.untilTurn + '. Both sides are equally distant.');
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
  function requestDoctrine(reason) {
    if (!game || game.over || interactionLocked() || orders.length || saltkinAI.pending ||
        saltkinAI.lastRequestTurn === game.turn) return;
    var requestMatch = matchId, snapshotTurn = game.turn;
    var seq = ++saltkinAI.requestSeq;
    var payload = CF.profile.requestPayload(game, requestMatch);
    payload.trigger = reason;
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
      saltkinAI.doctrine = response.decision;
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
      say('b', 'Saltkin doctrine: ' + response.decision.stance + ' · ' + response.decision.intent);
      endAIWait('doctrine');
      renderFeed();
      refresh();
    }).catch(function (err) {
      if (requestMatch !== matchId || seq !== saltkinAI.requestSeq) return;
      saltkinAI.pending = false;
      saltkinAI.doctrine = null;
      saltkinAI.uses = 0;
      saltkinAI.source = 'FALLBACK';
      saltkinAI.error = (err && err.code) || 'request_failed';
      say('b', 'Saltkin AI fallback (' + saltkinAI.error + '). Deterministic strategy remains active.');
      updateAIWait('doctrine', {
        fallback: true,
        title: 'Signal lost — field doctrine takes over',
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
  function spent() {
    return E.planCost(game, 1, orders, supportRequested).total;
  }

  function fieldPreview(extra) {
    return E.commandPreview(game, 1, extra ? orders.concat(extra) : orders);
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
    var from = null;
    if (tool === 'expand') {
      if (orders.some(function (o) { return o.type === 'expand' && o.to === i; })) { rejectOrder(i, 'Already claiming that square.'); return; }
      from = E.canExpand(game, 1, i, orders);
      if (from == null) { rejectOrder(i, 'You can only settle empty land next to ground you already hold.'); return; }
    } else if (tool === 'fortify') {
      if (orders.some(function (o) { return o.type === 'fortify' && o.to === i; })) {
        rejectOrder(i, 'A square can be fortified only once per turn.');
        return;
      }
      from = E.canFortify(game, 1, i);
      if (from == null) {
        if (game.tiles[i] && game.tiles[i].owner === 1 && game.supply[i] !== 1)
          rejectOrder(i, 'Cut-off ground cannot be fortified. Restore its Relay or capital connection first.');
        else if (game.tiles[i] && game.tiles[i].owner === 1 && game.tiles[i].str >= E.MAX_STRENGTH)
          rejectOrder(i, 'That square is already at the strength cap of ' + E.MAX_STRENGTH + '.');
        else rejectOrder(i, 'Fortify a supplied square you hold.');
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
    var plan = E.planCost(game, 1, orders.concat(candidate), supportRequested);
    var budget = E.availableBudget(game, 1);
    if (plan.total > budget) {
      rejectOrder(i, 'Not enough available supply. This plan costs ' + plan.total + '; you have ' + budget + '.');
      return;
    }
    orders.push(candidate);
    refresh();
  }

  function removeOrder(k) {
    if (interactionLocked()) return;
    orders.splice(k, 1);
    if (!E.supportType(game, 1, orders)) supportRequested = false;
    refresh();
  }

  function toggleSupport() {
    if (interactionLocked()) return;
    var type = E.supportType(game, 1, orders);
    if (!type) return;
    var next = !supportRequested;
    var plan = E.planCost(game, 1, orders, next);
    var budget = E.availableBudget(game, 1);
    if (next && plan.total > budget) {
      say('', 'Operation Support needs ' + E.SUPPORT_COST + ' more supply; this plan would cost ' + plan.total + '.');
      renderFeed();
      return;
    }
    supportRequested = next;
    refresh();
  }

  // =========================================================== turn cycle
  function endTurn() {
    if (interactionLocked() || game.over) return;
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
    lastBotEffort = plan.effort;
    if (saltkinAI.doctrine) saltkinAI.uses++;

    orders.support = supportRequested;
    var res = E.resolveTurn(game, orders, plan.orders);
    game = res.state;
    orders = [];
    supportRequested = false;
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
    if (!game.over && !limitReached && game.turn % 3 === 0 && !paused) {
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
      var immediate = D.decide(game);
      immediate.source = 'FALLBACK';
      immediate.reasoning = 'Source: FALLBACK · counterfactual_error\n\n' + immediate.reasoning;
      directorAudit = { prepared: null, source: 'FALLBACK', error: 'counterfactual_error' };
      finishDirector(run, immediate, 'Counterfactual table unavailable — safe baseline selected.');
      return;
    }

    if (!prepared.candidates.length) {
      var emptyFallback = prepared.baseline;
      emptyFallback.source = 'FALLBACK';
      emptyFallback.reasoning = 'Source: FALLBACK · no_safe_candidates\n\n' + emptyFallback.reasoning;
      directorAudit.source = 'FALLBACK';
      directorAudit.error = 'no_safe_candidates';
      finishDirector(run, emptyFallback, 'No safe candidate survived validation — safe baseline selected.');
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
      queueDirectorEvent(ev);
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
    var result = [], budget = E.availableBudget(game, 1);
    for (var i = 0; i < game.tiles.length; i++) {
      var from = null, special = false;
      if (tool === 'expand') {
        if (orders.some(function (o) { return o.type === 'expand' && o.to === i; })) continue;
        from = E.canExpand(game, 1, i, orders);
      } else if (tool === 'fortify') {
        if (orders.some(function (o) { return o.type === 'fortify' && o.to === i; })) continue;
        from = E.canFortify(game, 1, i);
      } else {
        var used = orders.filter(function (o) { return o.type === 'raid' && o.to === i; })
          .map(function (o) { return o.from; });
        from = E.canRaid(game, 1, i, used);
        special = used.length > 0 && from != null;
      }
      if (from == null) continue;
      var candidate = { type: tool, to: i, from: from };
      var trial = orders.concat(candidate);
      var plan = E.planCost(game, 1, trial, supportRequested);
      if (plan.ok && plan.total <= budget) result.push({ i: i, special: special });
    }
    return result;
  }

  function refresh() {
    if (!game) return;
    var gross = E.income(game, 1), budget = E.availableBudget(game, 1), sp = spent();

    $('hud-turn').textContent = Math.min(game.turn, E.MAX_TURNS);
    $('hud-season').textContent = game.season;
    $('hud-a-land').textContent = E.landCount(game, 1);
    $('hud-b-land').textContent = E.landCount(game, 2);
    $('hud-a-bp').style.width = Math.min(100, game.bp[1] / E.BEACON_TO_WIN * 100) + '%';
    $('hud-b-bp').style.width = Math.min(100, game.bp[2] / E.BEACON_TO_WIN * 100) + '%';
    $('hud-a-bplabel').textContent = game.bp[1] + ' / ' + E.BEACON_TO_WIN;
    $('hud-b-bplabel').textContent = game.bp[2] + ' / ' + E.BEACON_TO_WIN;

    $('hud-income').textContent = budget;
    $('hud-gross').textContent = gross;
    $('hud-reserve').textContent = game.reserve && game.reserve[1] || 0;
    $('hud-spent').textContent = sp;
    $('hud-left').textContent = Math.max(0, budget - sp);
    $('hud-command-used').textContent = fieldSpent();
    $('hud-command-left').textContent = Math.max(0, E.FIELD_COMMANDS - fieldSpent());
    var fill = $('hud-spendfill');
    fill.style.width = budget ? Math.min(100, sp / budget * 100) + '%' : '0%';
    fill.classList.toggle('over', sp > budget);

    var rc = E.raidCost(game);
    $('cost-raid').textContent = rc;
    $('cost-raid').classList.toggle('raised', rc > E.COST.raid);

    renderOrders();
    renderSupport();
    renderPlayerEffort();
    renderMods();
    renderWarning();
    renderChronicle();
    renderConsole();
    R.setPreview(orders);
    R.setLegalTargets(legalTargetsForTool(), tool);
    $('btn-end-label').textContent = orders.length
      ? 'RESOLVE ' + orders.length + (orders.length === 1 ? ' ORDER' : ' ORDERS') + ' · ' + sp + ' SUPPLY'
      : 'END TURN · HOLD';
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
    var command = fieldPreview();
    if (command.redeploys) {
      var redeploy = document.createElement('li');
      redeploy.className = 'redeploy';
      redeploy.innerHTML = '<span class="oi">↻</span><span>Redeploy to ' + command.main +
        '</span><span class="oc">−' + E.MOBILIZATION_COST + ' · 1 CMD</span>';
      redeploy.title = 'Changing route consumes one Field Command and mobilization supply; remove the queued order to cancel it.';
      ul.appendChild(redeploy);
    } else if (command.mobilizationCost) {
      var mobilize = document.createElement('li');
      mobilize.className = 'mobilize';
      mobilize.innerHTML = '<span class="oi">⚑</span><span>Mobilize second command</span><span class="oc">−' +
        command.mobilizationCost + '</span>';
      mobilize.title = 'The second Field Command costs additional supply to mobilize.';
      ul.appendChild(mobilize);
    }
    orders.forEach(function (o, k) {
      var li = document.createElement('li');
      li.className = o.type;
      var icon = o.type === 'expand' ? '✚' : o.type === 'fortify' ? '⛨' : '⚔';
      var label = o.type === 'raid'
        ? E.coord(game, o.from) + ' → ' + E.coord(game, o.to)
        : E.coord(game, o.to);
      li.innerHTML = '<span class="oi">' + icon + '</span><span>' + U.cap(o.type) + ' ' + label +
                     '</span><span class="oc">−' + E.costOf(game, o.type) + '</span>' +
                     '<button class="order-remove" type="button" aria-label="Remove ' + U.cap(o.type) +
                     ' order at ' + E.coord(game, o.to) + '">×</button>';
      li.querySelector('.order-remove').onclick = function () { removeOrder(k); };
      ul.appendChild(li);
    });
    var support = E.supportType(game, 1, orders);
    if (supportRequested && support) {
      var supportRow = document.createElement('li');
      supportRow.className = 'support';
      supportRow.innerHTML = '<span class="oi">★</span><span>' +
        (support === 'march' ? 'March Supply' : 'Siege Support') +
        '</span><span class="oc">−' + E.SUPPORT_COST + '</span>';
      supportRow.title = 'Click Operation Support above to remove this upgrade.';
      ul.appendChild(supportRow);
    }
  }

  function renderSupport() {
    var button = $('btn-support');
    var type = E.supportType(game, 1, orders);
    if (!type) supportRequested = false;
    button.disabled = !type;
    button.classList.toggle('active', !!(type && supportRequested));
    var title = button.querySelector('b'), detail = button.querySelector('span');
    title.textContent = type === 'march' ? 'MARCH SUPPLY · +' + E.SUPPORT_COST
      : type === 'siege' ? 'SIEGE SUPPORT · +' + E.SUPPORT_COST
      : 'OPERATION SUPPORT · +' + E.SUPPORT_COST;
    detail.textContent = type === 'march' ? 'Second chained Expand starts at strength 2'
      : type === 'siege' ? 'Coordinated Raid gains +1 attack'
      : 'Queue a chained Expand or coordinated Raid';
  }

  function renderPlayerEffort() {
    var el = $('player-effort');
    var preview = fieldPreview();
    var current = game.strategy && game.strategy[1];
    el.classList.toggle('redeploy', preview.redeploys > 0);
    if (!current && !orders.length) {
      el.textContent = 'ASH SURGE · ' + game.opening.route + ' · FIRST ORDER LOCKS 3 TURNS';
      return;
    }
    var main = preview.main || current && current.main || game.opening.route;
    var until = preview.untilTurn || current && current.untilTurn || game.turn + E.EFFORT_HORIZON - 1;
    if (preview.redeploys) {
      el.textContent = 'REDEPLOY → ' + main + ' · ACTION USES BOTH COMMANDS · LOCK THROUGH T' + until;
    } else if (until >= game.turn) {
      el.textContent = 'MAIN EFFORT · ' + main + ' · LOCKED THROUGH T' + until;
    } else {
      el.textContent = 'MAIN EFFORT · ' + main + ' · REDEPLOY AVAILABLE FOR 1 COMMAND';
    }
  }

  function renderMods() {
    var box = $('modlist');
    box.innerHTML = '';
    var m = game.mods;
    function tag(txt) { var d = document.createElement('div'); d.className = 'mod'; d.textContent = txt; box.appendChild(d); }
    if (m.ashfall > 0) tag('ASHFALL · raids cost double · ' + m.ashfall + 'T');
    if (m.rockCooled > 0) tag('ROCK COOLED · height gives nothing · ' + m.rockCooled + 'T');
    if (m.storm > 0) tag('STORM · the weather favours the loser · ' + m.storm + 'T');
    if (game.opening && game.turn <= game.opening.untilTurn)
      tag('ASH SURGE · ' + game.opening.route + ' ROUTE · +1 SUPPLIED FERTILITY · THROUGH T' + game.opening.untilTurn);
    if (game.pressure && game.pressure.staleTurns >= 2)
      tag('CINDER PRESSURE · stillness ' + game.pressure.staleTurns + 'T');
    if (game.pressure && game.pressure.bridgeTurns > 0)
      tag('CENTRAL CROSSING OPEN · ' + game.pressure.bridgeTurns + 'T');
    var cut = 0;
    for (var i = 0; i < game.tiles.length; i++)
      if (game.tiles[i].owner === 1 && game.supply[i] !== 1) cut++;
    if (cut) tag(U.plural(cut, 'square') + ' CUT OFF · starving');
  }

  function renderWarning() {
    var bar = $('warnbar'), p = game.pending;
    if (!p && game.pressure && game.pressure.staleTurns >= 2) {
      bar.classList.remove('hidden');
      $('warn-title').textContent = 'WARNING · CINDER PRESSURE';
      $('warn-sub').textContent = game.pressure.bridgeTurns > 0
        ? 'A temporary central crossing is open. Break through before the caldera takes it back.'
        : game.pressure.staleTurns >= 3
          ? 'Overbuilt front lines are eroding. Continued stillness will open a temporary central crossing.'
          : 'Two turns without territorial change. Cinder is preparing an attack window.';
      $('warn-count').textContent = game.pressure.bridgeTurns > 0
        ? game.pressure.bridgeTurns + ' turns left' : 'pressure ' + game.pressure.staleTurns;
      return;
    }
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

    var doctrineText = saltkinAI.doctrine ? JSON.stringify(saltkinAI.doctrine, null, 2) : 'heuristic fallback';
    $('con-doctrine').textContent = doctrineText + '\n\nsource=' + saltkinAI.source +
      ' · used=' + saltkinAI.uses + '/3' + (saltkinAI.requestId ? ' · request=' + saltkinAI.requestId : '');
    var playerProfile = CF.profile.build(game, CF.profile.load());
    $('con-profile').textContent = JSON.stringify(playerProfile.features, null, 2) +
      '\n\nEVIDENCE\n' + JSON.stringify(playerProfile.evidence, null, 2);
    var effortText = lastBotEffort
      ? ' · MAIN ' + lastBotEffort.main + ' / ' + lastBotEffort.secondary + ' · through T' + lastBotEffort.untilTurn
      : '';
    $('saltkin-intent').textContent = saltkinAI.doctrine
      ? 'SALTKIN AI · ' + saltkinAI.doctrine.stance + ' / ' + saltkinAI.doctrine.objective + ' · ' + saltkinAI.doctrine.intent
        + effortText
      : 'SALTKIN AI · FALLBACK · deterministic ' + lastBotMood + ' strategy' + effortText;

    if (!directorAudit || !directorAudit.prepared) {
      $('con-candidates').textContent = 'no season evaluated yet';
    } else {
      var prepared = directorAudit.prepared;
      var candidateLines = prepared.candidates.map(function (c) {
        return c.id + ' ' + EV.nameOf(c.event.template) + ' I'.repeat(c.event.intensity) + ' ' + c.event.region.toUpperCase() +
          ' · raids ' + c.summary.raids_per_turn.median + ' · captures ' + c.summary.captures.median +
          ' · gap ' + c.summary.land_gap.median;
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
    $('btn-support').onclick = toggleSupport;
    $('btn-clear').onclick = function () {
      if (interactionLocked()) return;
      orders = []; supportRequested = false; refresh();
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
      ev.warning = EV.warningFor(ev);
      var approval = CF.validator.approveOverride(game, ev);
      if (!approval.ok) {
        say('world', 'Designer override refused — ' + approval.fails.join('; ') + '.');
        renderFeed();
        refresh();
        return;
      }
      ev.reasoning = 'Overridden by the designer.\n\nGuardrails: passed.';
      ev.report = game.pending ? game.pending.report : '(no report — human override)';
      ev.mainTarget = approval.mainTarget;

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
      else if (e.key === '2') setTool('fortify');
      else if (e.key === '3') setTool('raid');
      else if (e.key === 'Enter') endTurn();
      else if (e.key === 'Escape') { orders = []; supportRequested = false; refresh(); }
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
      rows.push(['strength', t.str]);
      rows.push(['height', t.elev + (game.mods.rockCooled > 0 ? ' (giving nothing)' : '')]);
      rows.push(['fertility', t.fert + (t.crater ? ' · ash' : '')]);
      rows.push(['defence', E.defenceValue(game, i)]);
      if (t.owner && t.owner !== 3 && game.supply[i] !== t.owner) rows.push(['supply', 'CUT OFF']);
      if (t.capital) rows.push(['', 'CAPITAL']);
      if (t.relay) rows.push(['relay', t.relay + ' · SUPPLY RELAY']);
      if (t.temporaryBridge) rows.push(['', 'TEMPORARY CROSSING']);
    }
    if (i === game.beacon) {
      var beaconSupplied = t.owner && game.supply[i] === t.owner;
      rows.push(['', 'THE BEACON' + (t.owner && !beaconSupplied ? ' · NO SUPPLY / NO SCORE' : '')]);
    }

    var hint = '';
    if (t.land) {
      if (tool === 'raid') {
        var used = orders.filter(function (o) { return o.type === 'raid' && o.to === i; })
          .map(function (o) { return o.from; });
        var src = E.canRaid(game, 1, i, used);
        if (src != null) {
          var sources = used.concat([src]);
          var attack = E.coordinatedAttackValue(game, sources, 1);
          var coordinated = sources.length >= 2 && sources.every(function (from) { return game.supply[from] === 1; });
          if (coordinated && supportRequested && E.supportType(game, 1, orders) === 'siege')
            attack += E.SIEGE_SUPPORT_BONUS;
          hint = (coordinated ? 'coordinated raid +2 from ' : 'raid from ') + E.coord(game, src) + ': ' +
            attack + ' against ' + E.defenceValue(game, i) +
            (attack > E.defenceValue(game, i) ? ' — it falls' : ' — it holds');
        }
      } else if (tool === 'expand') {
        var expandFrom = E.canExpand(game, 1, i, orders);
        if (expandFrom != null) {
          var chained = game.tiles[expandFrom].owner !== 1;
          hint = (chained ? 'continue advance' : 'settle') + ' for ' + E.COST.expand + ', starts at strength 1';
        }
      } else if (tool === 'fortify') {
        if (E.canFortify(game, 1, i) != null) hint = 'fortify for ' + E.COST.fortify + ' → strength ' + Math.min(E.MAX_STRENGTH, t.str + E.FORTIFY_GAIN);
      }
      if (t.relay && t.owner === 2) {
        var impact = E.relayImpact(game, 1, i);
        if (impact && (impact.tiles || impact.beacon)) {
          hint += (hint ? ' · ' : '') + 'controlling this Relay cuts ' + impact.tiles + ' Saltkin squares, ' +
            impact.fertility + ' fertility' + (impact.beacon ? ', and Beacon supply' : '');
        }
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
