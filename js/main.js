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
  var mockPlayerAI = { pending: false, doctrine: null, source: 'IDLE', model: null, latencyMs: 0, error: null };
  var aiWaits = {};
  var thinkingTimer = 0;
  var thinkingFocus = null;
  var flowSerial = 0;
  var currentRun = null;
  var flowTimers = [];
  var language = 'en';

  var $ = function (id) { return document.getElementById(id); };

  // This intentionally covers stable, player-facing controls. Match reports
  // and model responses keep their original language so a translation never
  // masquerades as what the AI actually said.
  var UI_COPY = {
    en: {
      'brand.tagline': 'a world that refuses to sit still',
      'hud.turns': '/ 25 turns', 'hud.season': 'SEASON', 'hud.land': 'land',
      'settings.button': 'SETTINGS', 'settings.title': 'GAME SETTINGS',
  'settings.guide': 'HOW TO PLAY',
  'settings.guideCopy': 'Open the short visual guide at any time.',
      'settings.language': 'LANGUAGE',
      'settings.languageCopy': 'Changes the core game interface. AI and match records retain their original language.',
      'tabs.orders': 'ORDERS', 'tabs.chronicle': 'CHRONICLE',
      'chronicle.note': 'Every season the mountain acts, and every season it says why. Predictions are scored against what actually happened.',
      'cinder.note': 'Designer audit console. Two goal-limited AIs propose — deterministic code approves — a human can override safely.',
      'cinder.runtime': 'AI RUNTIME', 'cinder.doctrine': 'SALTKIN DOCTRINE',
      'cinder.profile': 'PLAYER PROFILE · RESOLVED HISTORY ONLY', 'cinder.reading': 'CURRENT READING',
      'cinder.evidence': 'DECISION EVIDENCE', 'cinder.candidates': 'COUNTERFACTUAL CANDIDATES · SHADOW BASELINE',
      'cinder.pending': 'PENDING EVENT', 'cinder.override': 'OVERRIDE', 'cinder.controls': 'CONTROLS',
      'cinder.pause': 'pause the director', 'cinder.turtle': 'force stalemate (both sides turtle)',
      'cinder.fail': 'simulate AI failure (3s → FALLBACK)', 'cinder.fire': 'fire now',
      'cinder.new': 'new ring', 'cinder.clearMemory': 'clear player memory',
      'cinder.mockTitle': 'MOCK PLAYER · LLM TEST',
      'cinder.mockNote': 'Ask the configured LLM for an Ashfarer doctrine. The legal bot turns it into a visible, valid queue; it never bypasses rules.',
      'cinder.mockButton': 'MOCK LLM MOVE', 'cinder.memory': 'TEMPLATE MEMORY',
      'orders.available': 'AVAILABLE', 'orders.spent': 'spent', 'orders.unspent': 'unspent',
      'orders.income': 'income', 'orders.reserve': 'reserve', 'orders.moves': 'MOVES',
      'orders.left': 'left', 'orders.queued': 'QUEUED', 'orders.clear': 'clear', 'orders.howToPlay': 'HOW TO PLAY',
      'tool.claim': 'CLAIM', 'tool.claimHint': 'take an empty tile beside you',
      'tool.hold': 'HOLD', 'tool.holdHint': 'make one supplied tile stronger',
      'tool.attack': 'ATTACK', 'tool.attackHint': 'take an enemy tile beside you',
      'tool.combo': 'COMBO', 'tool.comboHint': 'unlock with two linked actions',
      'map.legal': 'glow = can act', 'map.relay': 'Relay = cut supply', 'map.beacon': 'Beacon = score',
      'intro.skip': 'SKIP', 'intro.back': 'BACK',
      'intro.hero.kicker': 'GARENA AI BUILD CHALLENGE · 2026',
      'intro.hero.line': 'A world that refuses to sit still.',
      'intro.hero.sub1': 'Take land, cut a Relay, then keep the Beacon supplied.',
      'intro.hero.sub2': 'Cinder reads the battle and reshapes the next opportunity fairly.',
      'intro.hero.you': '· you', 'intro.hero.rival': '· the rival', 'intro.hero.world': '· the world itself',
      'intro.map.kicker': '1 / 3 · READ THE RING',
      'intro.map.title': 'Two fronts. Two cross-bridges. One enemy rear.',
      'intro.map.north': 'NORTH · HIGH / SHORT', 'intro.map.south': 'SOUTH · FERTILE / LONG', 'intro.map.relay': 'RELAY',
      'intro.map.caption': 'Break NORTH → cross at the eastern bridge → enter the SOUTH rear.',
      'intro.map.step1.title': 'Choose a front.', 'intro.map.step1.body': 'The high route is shorter; the fertile route pays more income.',
      'intro.map.step2.title': 'Use bridges to flank.', 'intro.map.step2.body': "A cross-bridge is not a third capital route. It lets a breakthrough reach the other front's rear.",
      'intro.map.step3.title': 'Take the Relay.', 'intro.map.step3.body': 'Each bridge lands on a two-tile Supply Relay. It is a tactical objective, not an income tile.',
      'intro.map.step4.title': 'Watch the Beacon.', 'intro.map.step4.body': 'Both capitals begin equally far from its opening route.',
      'intro.ai.kicker': '3 / 3 · CINDER ADAPTS', 'intro.ai.title': 'The AI Director gives both sides a fair new decision.',
      'intro.ai.queue': 'QUEUE', 'intro.ai.queueSub': '1 / 2 / 3 + map', 'intro.ai.saltkinSub': 'secret orders',
      'intro.ai.resolve': 'RESOLVE', 'intro.ai.resolveSub': 'simultaneous', 'intro.ai.turn2': 'TURN 2',
      'intro.ai.warning': '⚠ WARNING · NORTH COAST', 'intro.ai.turn3': 'TURN 3', 'intro.ai.acts': 'CINDER ACTS',
      'intro.ai.victory': '10 SUPPLIED BEACON POINTS', 'intro.ai.victorySub': 'or most land after 25 resolved turns',
      'intro.ai.step1.title': 'Play first; the rival cannot see your queued moves.', 'intro.ai.step1.body': 'When you end the turn, both sides resolve together.',
      'intro.ai.step2.title': 'Every third turn, Director reads the public battle.', 'intro.ai.step2.body': 'It compares safe map changes, explains why it chose one, then warns before it acts.',
      'intro.ai.step3.title': 'It adapts, never rigs the match.', 'intro.ai.step3.body': 'Capitals and Relays stay protected; the same opportunity is available to both sides.',
      'intro.ai.claim': 'Claim', 'intro.ai.hold': 'Hold', 'intro.ai.attack': 'Attack', 'intro.ai.end': 'End turn', 'intro.ai.clear': 'Clear queue'
    },
    zh: {
      'brand.tagline': '一座永不静止的火山群岛',
      'hud.turns': '/ 25 回合', 'hud.season': '季节', 'hud.land': '领地',
      'settings.button': '设置', 'settings.title': '游戏设置',
  'settings.guide': '玩法说明',
  'settings.guideCopy': '随时查看简短的图文玩法说明。',
      'settings.language': '界面语言',
      'settings.languageCopy': '切换核心操作界面。AI 输出与对战记录保留其原始语言。',
      'tabs.orders': '指令', 'tabs.chronicle': '战报',
      'chronicle.note': '每个赛季，Cinder 都会行动并说明原因；它的预测会与实际结果进行核验。',
      'cinder.note': '设计审计台：受目标限制的 AI 提出方案，确定性规则负责审批；人工可安全介入。',
      'cinder.runtime': 'AI 运行状态', 'cinder.doctrine': '盐潮军策略（模型原始输出）',
      'cinder.profile': '玩家画像 · 仅使用已结算历史', 'cinder.reading': '当前战局摘要',
      'cinder.evidence': '决策依据', 'cinder.candidates': '反事实候选 · 对照基线',
      'cinder.pending': '待触发事件', 'cinder.override': '人工覆盖', 'cinder.controls': '调试控制',
      'cinder.pause': '暂停 Director', 'cinder.turtle': '强制僵持（双方均采取龟缩策略）',
      'cinder.fail': '模拟 AI 失败（3 秒后转为 FALLBACK）', 'cinder.fire': '立即触发',
      'cinder.new': '新开战局', 'cinder.clearMemory': '清除玩家画像',
      'cinder.mockTitle': '模拟玩家 · LLM 测试',
      'cinder.mockNote': '让已配置的 LLM 提出 Ashfarers 策略。合法机器人会把它转成可见且有效的指令队列，绝不会绕过规则。',
      'cinder.mockButton': '调用 LLM 模拟行动', 'cinder.memory': '事件模板记忆',
      'orders.available': '可用 Supply', 'orders.spent': '已花费', 'orders.unspent': '未花费',
      'orders.income': '收入', 'orders.reserve': '储备', 'orders.moves': '行动',
      'orders.left': '剩余', 'orders.queued': '已排队', 'orders.clear': '清空', 'orders.howToPlay': '游戏引导',
      'tool.claim': '扩张', 'tool.claimHint': '占领相邻的空地',
      'tool.hold': '固守', 'tool.holdHint': '强化一格有补给的领地',
      'tool.attack': '进攻', 'tool.attackHint': '夺取相邻的敌方领地',
      'tool.combo': '连携', 'tool.comboHint': '完成两次连续行动后解锁',
      'map.legal': '发光边框 = 可行动', 'map.relay': 'Relay = 切断补给', 'map.beacon': 'Beacon = 得分',
      'intro.skip': '跳过', 'intro.back': '返回',
      'intro.hero.kicker': 'GARENA AI BUILD CHALLENGE · 2026',
      'intro.hero.line': '一座永不静止的火山群岛。',
      'intro.hero.sub1': '扩张领地，夺取 Relay，并保持 Beacon 的补给。',
      'intro.hero.sub2': 'Cinder 会读取已发生的战局，公平地重组下一次机会。',
      'intro.hero.you': '· 你', 'intro.hero.rival': '· 对手', 'intro.hero.world': '· 世界本身',
      'intro.map.kicker': '1 / 3 · 认识战场',
      'intro.map.title': '两条战线、两座横桥、一个敌方后方。',
      'intro.map.north': '北路 · 更近 / 更险', 'intro.map.south': '南路 · 更远 / 更富饶', 'intro.map.relay': '中继站',
      'intro.map.caption': '突破北路 → 通过东侧横桥 → 切入南路后方。',
      'intro.map.step1.title': '先选一条战线。', 'intro.map.step1.body': '高地路线更短；肥沃路线会提供更多 Supply。',
      'intro.map.step2.title': '利用横桥包抄。', 'intro.map.step2.body': '横桥不是第三条主路；它让你在突破后切入另一条战线的后方。',
      'intro.map.step3.title': '争夺 Relay。', 'intro.map.step3.body': '每座横桥都连接一组两格的补给中继站；它是战术目标，不是收入地块。',
      'intro.map.step4.title': '留意 Beacon。', 'intro.map.step4.body': '双方到开局 Beacon 路线的距离完全相等。',
      'intro.ai.kicker': '3 / 3 · CINDER 适配战局', 'intro.ai.title': 'AI Director 为双方创造公平的新选择。',
      'intro.ai.queue': '排队', 'intro.ai.queueSub': '操作 1 / 2 / 3 + 点地图', 'intro.ai.saltkinSub': '秘密指令',
      'intro.ai.resolve': '结算', 'intro.ai.resolveSub': '同时发生', 'intro.ai.turn2': '第 2 回合',
      'intro.ai.warning': '⚠ 预警 · 北岸', 'intro.ai.turn3': '第 3 回合', 'intro.ai.acts': 'CINDER 行动',
      'intro.ai.victory': '10 点已补给的 Beacon 分', 'intro.ai.victorySub': '或第 25 回合后占有更多领地',
      'intro.ai.step1.title': '先下指令；对手看不到你的队列。', 'intro.ai.step1.body': '结束回合后，双方指令会同时结算。',
      'intro.ai.step2.title': '每三回合，Director 读取公开战况。', 'intro.ai.step2.body': '它比较安全的地图改变，说明选择理由，再提前给出预警。',
      'intro.ai.step3.title': '它会适配，但绝不操纵胜负。', 'intro.ai.step3.body': 'Capital 与 Relay 受规则保护；双方获得同样的机会。',
      'intro.ai.claim': '扩张', 'intro.ai.hold': '固守', 'intro.ai.attack': '进攻', 'intro.ai.end': '结束回合', 'intro.ai.clear': '清空队列'
    }
  };

  function savedLanguage() {
    try { return window.localStorage.getItem('cinderfall-language') === 'zh' ? 'zh' : 'en'; }
    catch (e) { return 'en'; }
  }

  function applyLanguage(next) {
    language = UI_COPY[next] ? next : 'en';
    var copy = UI_COPY[language];
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var text = copy[el.dataset.i18n];
      if (text) el.textContent = text;
    });
    if (CF.refreshIntroCopy) CF.refreshIntroCopy();
    if ($('settings-language')) $('settings-language').value = language;
    try { window.localStorage.setItem('cinderfall-language', language); } catch (e) {}
    // Dynamic panels are rendered from JavaScript rather than markup, so they
    // must be refreshed immediately when the language selector changes.
    if (game) { refresh(); renderFeed(); }
  }

  function isChinese() { return language === 'zh'; }
  function routeName(route) {
    if (!isChinese()) return route;
    return route === 'NORTH' ? '北路' : route === 'SOUTH' ? '南路' : route;
  }
  function actionName(type) {
    if (!isChinese()) return type === 'expand' ? 'Claim' : type === 'fortify' ? 'Hold' : 'Attack';
    return type === 'expand' ? '扩张' : type === 'fortify' ? '固守' : '进攻';
  }

  // Keep model payloads and diagnostic identifiers untouched, but translate
  // the player-facing event layer shown in Chronicle and Cinder.
  function eventName(id) {
    if (!isChinese()) return EV.nameOf(id);
    var names = {
      eruption: '火山喷发', tide: '潮汐回应', earthquake: '地震', new_island: '新岛升起',
      ashfall: '灰烬遮天', bloom: '灰烬复苏', beacon_move: '圣火迁移',
      rock_cools: '岩层冷却', settlers: '第三方登陆', storm: '风暴季'
    };
    return names[id] || EV.nameOf(id);
  }

  function eventRegion(region) {
    if (!isChinese()) return EV.regionName(region);
    return { north: '北部', south: '南部', east: '东部', west: '西部', centre: '环心地带' }[region] || '战场中央';
  }

  function localizedWarning(template, region, fallback) {
    if (!isChinese()) return fallback;
    var r = eventRegion(region);
    var copy = {
      eruption: '火山正在' + r + '震动。', tide: '海水正淹向' + r + '的低地。',
      earthquake: '地面正沿' + r + '开裂。', new_island: r + '的海水正在沸腾，新陆地即将升起。',
      ashfall: '灰烬正在笼罩整座环岛。', bloom: '雨云正在' + r + '聚集。',
      beacon_move: '塔上的圣火正在摇曳。', rock_cools: '各处高地正在崩解。',
      settlers: r + '近海出现陌生的船帆。', storm: '整座环岛的天气正在转变。'
    };
    return copy[template] || fallback;
  }

  function localizedEventMessage(template, text) {
    if (!isChinese()) return text;
    var match;
    if (template === 'eruption' && (match = /in the (.+?)\. (\d+) squares? gone, (\d+) buried/.exec(text)))
      return '火山在' + eventRegion(match[1]) + '喷发：' + match[2] + ' 格地块沉没，' + match[3] + ' 格成为最肥沃的灰烬土壤。';
    if (template === 'tide' && (match = /took back (\d+) low squares? in the (.+?)\./.exec(text)))
      return '海水在' + eventRegion(match[2]) + '收回了 ' + match[1] + ' 格低地；高地从不白送。';
    if (template === 'earthquake' && (match = /opened in the (.+?) and (\d+) squares?/.exec(text)))
      return '裂缝贯穿' + eventRegion(match[1]) + '，' + match[2] + ' 格地块沉入海中，补给线被切断。';
    if (template === 'new_island' && (match = /(\d+) new squares? pushed up out of the water in the (.+?)\./.exec(text)))
      return match[1] + ' 块新陆地在' + eventRegion(match[2]) + '浮出水面，尚无归属。';
    if (template === 'ashfall' && (match = /for (\d+) turns?/.exec(text)))
      return '灰烬遮蔽天空 ' + match[1] + ' 回合；所有进攻费用翻倍。';
    if (template === 'bloom' && (match = /on the (.+?)\. (\d+) squares? turned green/.exec(text)))
      return '雨水落在' + eventRegion(match[1]) + '，' + match[2] + ' 格地块变得肥沃；安静地带不再安静。';
    if (template === 'beacon_move') return '旧塔的圣火熄灭，并在双方之间的空地重新燃起；它从不属于任何一方。';
    if (template === 'rock_cools' && (match = /For (\d+) turns?/.exec(text)))
      return '岩层变得冰冷脆弱，持续 ' + match[1] + ' 回合；高度不再提供防御。';
    if (template === 'settlers' && (match = /in the (.+?) and took (\d+) squares?/.exec(text)))
      return '第三方势力在' + eventRegion(match[1]) + '登陆并占据 ' + match[2] + ' 格地块。';
    if (template === 'storm' && (match = /for (\d+) turns?/.exec(text)))
      return '风暴季持续 ' + match[1] + ' 回合；天气会偏向当前落后的一方。';
    return text;
  }

  function goalName(goal) {
    if (!isChinese()) return goal || '—';
    return {
      BREAK_STALEMATE: '打破僵局', RESTORE_COMPETITION: '恢复对抗',
      CREATE_CONTESTED_PRIZE: '创造争夺目标', PRESERVE_VARIETY: '保持变化',
      SLOW_RUNAWAY: '抑制滚雪球'
    }[goal] || '平衡战局';
  }

  function localizedReading(last) {
    if (!isChinese()) return last ? last.report : 'Cinder is asleep. It wakes at the end of turn 3.';
    if (!last) return 'Cinder 尚未苏醒；它会在第 3 回合结算后读取公开战局。';
    var ash = E.landCount(game, 1), salt = E.landCount(game, 2);
    var lines = ['第 ' + game.turn + ' 回合 · 当前赛季 ' + game.season + '。',
      'Ashfarers 占有 ' + ash + ' 格领地；Saltkin 占有 ' + salt + ' 格领地。'];
    lines.push(game.pending
      ? '下一项候选：' + eventName(game.pending.template) + '，将在第 ' + game.pending.fireTurn + ' 回合末触发。'
      : '当前没有待触发的世界事件。');
    return lines.join('\n');
  }

  function localizedDecisionEvidence(c) {
    if (!isChinese()) return c ? c.reasoning : '—';
    if (!c) return '—';
    var lines = ['选择：' + eventName(c.template) + ' · 强度 ' + 'I'.repeat(c.intensity || 1) +
      (c.region ? ' · 目标 ' + eventRegion(c.region) : '')];
    if (c.goal) lines.push('目标：' + goalName(c.goal));
    if (c.evidenceUsed && c.evidenceUsed.length) lines.push('读取的公开信号：' + c.evidenceUsed.join('、'));
    if (c.prediction && c.prediction.text) lines.push('预测：' + c.prediction.text);
    lines.push('安全性：候选已通过规则审查，事件触发前会再次检查地图。');
    return lines.join('\n\n');
  }

  var THINKING_COPY = {
    doctrine: {
      kicker: 'SALTKIN WAR COUNCIL', title: 'Reading the resolved battlefield',
      stages: ['Tracing supplied routes.', 'Weighing NORTH against SOUTH.', 'Counting exposed Relays.', 'Writing a two-turn doctrine.']
    },
    orders: {
      kicker: 'SALTKIN COMMAND TENT', title: 'Sealing the rival orders',
      stages: ['Placing the first command stone.', 'Testing the secondary front.', 'Funding any operation support.', 'Both envelopes are now sealed.']
    },
    director: {
      kicker: 'CINDER STIRS', title: 'The mountain reads the battle',
      stages: ['Reading the battle already fought.', 'Feeling the pressure points.', 'Weighing a fair new path.', 'Writing a warning for both sides.']
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
    if ($('btn-support')) {
      var supportType = game && E.supportType(game, 1, orders);
      var supportAffordable = game && spent() + E.SUPPORT_COST <= E.availableBudget(game, 1);
      $('btn-support').disabled = locked || !supportType || (!supportRequested && !supportAffordable);
    }
    if ($('btn-clear')) $('btn-clear').disabled = locked || !orders.length;
    if ($('btn-end')) $('btn-end').disabled = locked || !game || !!game.over;
    if ($('btn-settings')) $('btn-settings').disabled = locked;
    if ($('settings-tutorial')) $('settings-tutorial').disabled = locked;
    if ($('settings-language')) $('settings-language').disabled = locked;
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
    // First play is a 30-second orientation, not a rules manual.  The full
    // combat/economy detail remains in HOW TO PLAY after the first turn.
    var allSlides = [].slice.call(el.querySelectorAll('.slide'));
    var slides = [allSlides[0], allSlides[1], allSlides[5]];
    function copy(key) { return (UI_COPY[language] && UI_COPY[language][key]) || UI_COPY.en[key] || key; }

    CF.intro.init($('introcanvas'));

    function go(n) {
      slide = U.clamp(n, 0, slides.length - 1);
      allSlides.forEach(function (s) {
        var isActive = s === slides[slide];
        s.classList.toggle('active', isActive);
        s.setAttribute('aria-hidden', isActive ? 'false' : 'true');
        if (isActive) s.scrollTop = 0;
      });
      [].forEach.call(el.querySelectorAll('.dot-nav'), function (d, i) {
        d.classList.toggle('active', i === slide);
        if (i === slide) d.setAttribute('aria-current', 'step');
        else d.removeAttribute('aria-current');
      });
      $('intro-back').disabled = slide === 0;
      $('intro-progress').textContent = language === 'zh'
        ? (slide + 1) + ' / ' + slides.length
        : (slide + 1) + ' OF ' + slides.length;
      var labels = language === 'zh'
        ? ['查看地图 <kbd>→</kbd>', '认识 Cinder <kbd>→</kbd>', '开始游戏 <kbd>⏎</kbd>']
        : ['READ THE MAP <kbd>→</kbd>', 'MEET CINDER <kbd>→</kbd>', 'START PLAYING <kbd>⏎</kbd>'];
      $('intro-next').innerHTML = labels[slide];
      if (CF.intro.setScene) CF.intro.setScene(slide);
    }

    function dismiss() {
      // The intro element starts visible in HTML.  Dismiss from its visible
      // state rather than an async-local flag, so Skip always works even if
      // the initial AI health check resolves before the intro binds.
      if (el.classList.contains('hidden') || el.classList.contains('leaving')) return;
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
      // The cold open is visible by default in the markup.  The first LLM
      // doctrine request may already be in flight when bindIntro runs; do not
      // leave that visible layer orphaned behind an interaction lock.  Replays
      // still respect the lock once the intro has been dismissed.
      if (active || (interactionLocked() && el.classList.contains('hidden'))) return;
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
    [].forEach.call(el.querySelectorAll('.dot-nav'), function (d) {
      d.onclick = function () { go(+d.dataset.go); };
    });

    CF.openTutorial = openIntro;
    CF.refreshIntroCopy = function () { go(slide); };

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
    mockPlayerAI = { pending: false, doctrine: null, source: 'IDLE', model: null, latencyMs: 0, error: null };
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
    // A remote doctrine is useful context, not a reason to freeze the first
    // playable moment.  Start with the deterministic commander and let the
    // LLM replace its intent when ready.  Later tactical re-reads can retain
    // the visible thinking state because the player has already learned the
    // basic loop.
    var showWait = reason !== 'match_start';
    saltkinAI.pending = true;
    saltkinAI.lastRequestTurn = snapshotTurn;
    saltkinAI.error = null;
    if (showWait) beginAIWait('doctrine', 'doctrine');
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

  // Designer test: LLM picks an Ashfarer doctrine, then the same deterministic
  // legal-order bot used by Saltkin turns it into an observable player queue.
  // This keeps a model test meaningful without letting a model cheat.
  function requestMockPlayerMove() {
    if (!game || game.over || interactionLocked()) return;
    var requestMatch = matchId + '-mock-' + game.turn + '-' + Date.now();
    var snapshotTurn = game.turn;
    var payload = CF.profile.requestPayload(game, requestMatch);
    payload.trigger = 'mock_player_turn';
    payload.publicState.controlledSide = 'ASHFARERS';
    payload.publicState.mainEffort = game.strategy && game.strategy[1] || null;
    mockPlayerAI.pending = true;
    mockPlayerAI.error = null;
    beginAIWait('mock-player', 'orders', 'Mock Player is choosing a doctrine; rules will generate the legal moves.');
    refresh();

    CF.ai.mockPlayer(payload).then(function (response) {
      if (!game || matchId !== requestMatch.split('-mock-')[0] || game.turn !== snapshotTurn ||
          response.matchId !== requestMatch || response.snapshotTurn !== snapshotTurn) return;
      var plan = CF.bot.plan(game, 1, false, response.decision);
      orders = plan.orders.slice();
      supportRequested = !!plan.orders.support;
      mockPlayerAI = {
        pending: false, doctrine: response.decision, source: response.meta.source || 'LLM',
        model: response.meta.model || null, latencyMs: response.meta.latencyMs || 0, error: null
      };
      var summary = orders.map(function (o) {
        return o.type === 'raid' ? 'Attack ' + E.coord(game, o.from) + '→' + E.coord(game, o.to)
          : U.cap(o.type) + ' ' + E.coord(game, o.to);
      }).join(' + ') || 'no legal move';
      say('a', 'MOCK PLAYER · ' + response.decision.stance + ' / ' + response.decision.objective +
        ' — ' + response.decision.intent + ' Queued: ' + summary + '.');
      endAIWait('mock-player');
      renderFeed();
      refresh();
    }).catch(function (err) {
      if (!game || game.turn !== snapshotTurn) return;
      var fallback = CF.bot.plan(game, 1, false, null);
      orders = fallback.orders.slice();
      supportRequested = !!fallback.orders.support;
      mockPlayerAI = {
        pending: false, doctrine: null, source: 'FALLBACK', model: null, latencyMs: 0,
        error: (err && err.code) || 'request_failed'
      };
      say('a', 'MOCK PLAYER fallback (' + mockPlayerAI.error + ') queued a deterministic legal move.');
      endAIWait('mock-player');
      renderFeed();
      refresh();
    });
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
      // Ask only for player-facing prose in the active interface language;
      // candidate selection remains bounded by deterministic validation.
      prepared.payload.displayLanguage = isChinese() ? 'zh-CN' : 'en';
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

    // Cloud reasoning improves the showcase, but may never hold a playable
    // turn hostage. After five seconds, the same pre-validated baseline
    // continues the match; a later cloud response cannot rewrite that turn.
    var settled = false;
    var deadline = setTimeout(function () {
      if (settled || !isCurrentRun(run)) return;
      settled = true;
      directorFallback(run, prepared, { code: 'interaction_budget' });
    }, 5000);
    function clearDeadline() { clearTimeout(deadline); }
    function fallbackOnce(err) {
      if (settled || !isCurrentRun(run)) return;
      settled = true;
      clearDeadline();
      directorFallback(run, prepared, err);
    }

    CF.ai.director(prepared.payload).then(function (response) {
      if (settled || !isCurrentRun(run)) return;
      if (response.season !== prepared.report.season) {
        fallbackOnce({ code: 'season_mismatch' });
        return;
      }
      var ev;
      try { ev = D.fromLLM(game, prepared, response.decision, response.meta); }
      catch (err) { fallbackOnce(err); return; }
      if (!ev) { fallbackOnce({ code: 'unknown_candidate' }); return; }
      settled = true;
      clearDeadline();
      directorAudit.source = 'LLM';
      directorAudit.meta = response.meta;
      finishDirector(run, ev);
    }, function (err) { fallbackOnce(err); });
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
    finishDirector(run, ev, 'Cinder takes the safest path and the battle continues.');
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
    var commandLimit = E.fieldCommands(game);
    $('hud-command-used').textContent = fieldSpent();
    $('hud-command-max').textContent = commandLimit;
    $('hud-command-left').textContent = Math.max(0, commandLimit - fieldSpent());
    document.querySelector('.reserve-row').classList.toggle('hidden', game.stats.length < 2);
    var fill = $('hud-spendfill');
    fill.style.width = budget ? Math.min(100, sp / budget * 100) + '%' : '0%';
    fill.classList.toggle('over', sp > budget);

    var rc = E.raidCost(game);
    $('cost-raid').textContent = rc;
    $('cost-raid').classList.toggle('raised', rc > E.COST.raid);

    renderOrders();
    renderSupport();
    renderOpeningBrief();
    renderRouteGuides();
    renderPlayerEffort();
    renderMods();
    renderWarning();
    renderChronicle();
    renderConsole();
    R.setPreview(orders);
    R.setLegalTargets(legalTargetsForTool(), tool);
    $('btn-end-label').textContent = orders.length
      ? (isChinese() ? '结算 ' + orders.length + ' 条指令 · ' + sp + ' Supply'
        : 'RESOLVE ' + orders.length + (orders.length === 1 ? ' ORDER' : ' ORDERS') + ' · ' + sp + ' SUPPLY')
      : (isChinese() ? '结束回合 · 待命' : 'END TURN · HOLD');
    syncControls();
  }

  function renderOrders() {
    var ul = $('orderlist');
    ul.innerHTML = '';
    if (!orders.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = isChinese()
        ? '暂无指令——选择操作后，点击地图上的发光地块'
        : 'no orders yet — pick a tool, then click the map';
      ul.appendChild(li);
      return;
    }
    var command = fieldPreview();
    if (command.redeploys) {
      var redeploy = document.createElement('li');
      redeploy.className = 'redeploy';
      redeploy.innerHTML = '<span class="oi">↻</span><span>' + (isChinese() ? '切换至 ' + routeName(command.main) : 'Switch front → ' + command.main) +
        '</span><span class="oc">' + (isChinese() ? '占用 2 次行动 · 尚余 1 次' : 'uses 2 actions · 1 remains') + '</span>';
      redeploy.title = isChinese()
        ? '切换战线需要一次重新部署与一次行动，但本回合仍可再执行 1 次操作。'
        : 'Changing front spends redeployment plus one action; one action remains this turn.';
      ul.appendChild(redeploy);
    } else if (command.mobilizationCost) {
      var mobilize = document.createElement('li');
      mobilize.className = 'mobilize';
      mobilize.innerHTML = '<span class="oi">⚑</span><span>' + (isChinese() ? '使用第二次行动' : 'Use your second move') + '</span><span class="oc">−' +
        command.mobilizationCost + '</span>';
      mobilize.title = isChinese() ? '第二次行动会额外消耗 Supply。' : 'Your second move costs additional supply.';
      ul.appendChild(mobilize);
    }
    orders.forEach(function (o, k) {
      var li = document.createElement('li');
      li.className = o.type;
      var icon = o.type === 'expand' ? '✚' : o.type === 'fortify' ? '⛨' : '⚔';
      var label = o.type === 'raid'
        ? E.coord(game, o.from) + ' → ' + E.coord(game, o.to)
        : E.coord(game, o.to);
      var orderName = actionName(o.type);
      li.innerHTML = '<span class="oi">' + icon + '</span><span>' + orderName + ' ' + label +
                     '</span><span class="oc">−' + E.costOf(game, o.type) + '</span>' +
                     '<button class="order-remove" type="button" aria-label="' +
                     (isChinese() ? '移除' : 'Remove ') + orderName +
                     (isChinese() ? ' 指令：' : ' order at ') + E.coord(game, o.to) + '">×</button>';
      li.querySelector('.order-remove').onclick = function () { removeOrder(k); };
      ul.appendChild(li);
    });
    var support = E.supportType(game, 1, orders);
    if (supportRequested && support) {
      var supportRow = document.createElement('li');
      supportRow.className = 'support';
      supportRow.innerHTML = '<span class="oi">★</span><span>' +
        (support === 'march'
          ? (isChinese() ? '扩张连携补给' : 'March Supply')
          : (isChinese() ? '进攻连携支援' : 'Siege Support')) +
        '</span><span class="oc">−' + E.SUPPORT_COST + '</span>';
      supportRow.title = isChinese() ? '再次点击上方连携按钮即可移除此强化。' : 'Click Operation Support above to remove this upgrade.';
      ul.appendChild(supportRow);
    }
  }

  function renderSupport() {
    var button = $('btn-support');
    var type = E.supportType(game, 1, orders);
    var affordable = spent() + E.SUPPORT_COST <= E.availableBudget(game, 1);
    if (!type) supportRequested = false;
    // A visible but unaffordable Combo is useful feedback, but it must never
    // look clickable.  It becomes removable again after it has been selected.
    button.disabled = !type || (!supportRequested && !affordable);
    button.classList.toggle('active', !!(type && supportRequested));
    button.setAttribute('aria-pressed', type && supportRequested ? 'true' : 'false');
    var title = button.querySelector('.tname'), detail = button.querySelector('em');
    title.textContent = type === 'march'
      ? (isChinese() ? '扩张连携' : 'CLAIM COMBO')
      : type === 'siege'
        ? (isChinese() ? '进攻连携' : 'ATTACK COMBO')
        : (isChinese() ? '连携' : 'COMBO');
    detail.textContent = type === 'march'
      ? (isChinese() ? '第二块连续扩张的地块以强度 2 建立' : 'Second chained Expand starts at strength 2')
      : type === 'siege'
        ? (isChinese() ? '协同进攻额外获得 +1 攻击力' : 'Coordinated Raid gains +1 attack')
        : (isChinese() ? '完成两次连续行动后解锁' : 'Unlock with two linked actions');
    if (type && !supportRequested && !affordable) {
      var shortfall = Math.max(0, spent() + E.SUPPORT_COST - E.availableBudget(game, 1));
      detail.textContent += isChinese() ? ' · 还差 ' + shortfall + ' Supply' : ' · need ' + shortfall + ' Supply';
    }
  }

  function renderPlayerEffort() {
    var el = $('player-effort');
    var preview = fieldPreview();
    var current = game.strategy && game.strategy[1];
    var actionLimit = E.fieldCommands(game);
    el.classList.toggle('redeploy', preview.redeploys > 0);
    if (preview.commands >= actionLimit) {
      var unspent = Math.max(0, E.availableBudget(game, 1) - spent());
      var banked = Math.max(0, E.income(game, 1) - spent());
      var combo = E.supportType(game, 1, orders);
      if (combo && unspent >= E.SUPPORT_COST && !supportRequested) {
        el.textContent = isChinese()
          ? '已用 ' + actionLimit + ' 次行动 · 剩余 ' + unspent + ' Supply · 花 2 点使用' +
            (combo === 'march' ? '扩张连携' : '进攻连携') + '，或存为 Reserve'
          : actionLimit + ' MOVES USED · ' + unspent + ' SUPPLY LEFT · SPEND 2 ON ' +
            (combo === 'march' ? 'CLAIM COMBO' : 'ATTACK COMBO') + ' OR BANK IT AS RESERVE';
      } else {
        el.textContent = isChinese()
          ? '已用 ' + actionLimit + ' 次行动 · 剩余 ' + unspent + ' Supply' +
            (banked ? ' · 下回合存为 ' + banked + ' Reserve' : '')
          : actionLimit + ' MOVES USED · ' + unspent + ' SUPPLY LEFT' +
            (banked ? ' · ' + banked + ' WILL BANK AS RESERVE NEXT TURN' : '');
      }
      return;
    }
    if (!current && !orders.length) {
      el.textContent = isChinese()
        ? '先选一路 · 第一次扩张会锁定路线 2 回合 · 先点“扩张”与发光地块'
        : 'CHOOSE A FRONT · YOUR FIRST CLAIM LOCKS IT FOR 2 TURNS · THEN PICK A GLOWING TILE';
      return;
    }
    if (orders.length && preview.commands < actionLimit) {
      var remainingActions = actionLimit - preview.commands;
      var remainingSupply = Math.max(0, E.availableBudget(game, 1) - spent());
      var linked = E.supportType(game, 1, orders);
      if (linked && remainingSupply >= E.SUPPORT_COST) {
        el.textContent = isChinese()
          ? '已排 ' + preview.commands + ' 次行动 · 还可行动 ' + remainingActions + ' 次 · 可固守已有领地，或花 2 Supply 使用连携'
          : preview.commands + ' MOVES QUEUED · ' + remainingActions + ' LEFT · HOLD EXISTING LAND OR SPEND 2 SUPPLY ON COMBO';
      } else {
        el.textContent = isChinese()
          ? '已排 ' + preview.commands + ' 次行动 · 还可行动 ' + remainingActions + ' 次 · 剩余 ' + remainingSupply + ' Supply'
          : preview.commands + ' MOVES QUEUED · ' + remainingActions + ' LEFT · ' + remainingSupply + ' SUPPLY REMAINS';
      }
      return;
    }
    var main = preview.main || current && current.main || game.opening.route;
    var until = preview.untilTurn || current && current.untilTurn || game.turn + E.EFFORT_HORIZON - 1;
    if (preview.redeploys) {
      el.textContent = isChinese()
        ? '切换至' + routeName(main) + ' · 会用掉 2 次行动 · 此后专注至第 ' + until + ' 回合'
        : 'SWITCH TO ' + main + ' · THIS USES BOTH MOVES · THEN FOCUS THROUGH T' + until;
    } else if (until >= game.turn) {
      el.textContent = isChinese()
        ? '已选择' + routeName(main) + ' · 第 ' + until + ' 回合结束前不可转向另一路'
        : 'YOU CHOSE ' + main + ' · THE OTHER FRONT IS LOCKED THROUGH T' + until;
    } else {
      el.textContent = isChinese()
        ? '主攻' + routeName(main) + ' · 本回合可以切换战线'
        : 'FOCUS · ' + main + ' · YOU MAY SWITCH FRONT THIS TURN';
    }
  }

  function renderRouteGuides() {
    var current = game.strategy && game.strategy[1];
    var preview = fieldPreview();
    var main = preview.main || current && current.main || null;
    var opening = game.opening && game.turn <= game.opening.untilTurn ? game.opening.route : null;
    ['NORTH', 'SOUTH'].forEach(function (route) {
      var el = $('route-guide-' + route.toLowerCase());
      var isMain = main === route;
      var isOpening = opening === route;
      el.classList.toggle('main', isMain);
      el.classList.toggle('opening', isOpening);
      var label = isChinese() ? routeName(route) : route + ' ROUTE';
      var state = isMain
        ? (isChinese() ? '已选择主攻' : 'MAIN FRONT SELECTED')
        : isOpening
          ? (isChinese() ? '开局肥沃加成' : 'OPENING FERTILITY +1')
          : (isChinese() ? '可选战线' : 'AVAILABLE FRONT');
      el.innerHTML = label + '<span class="route-state">' + state + '</span>';
    });
  }

  function renderOpeningBrief() {
    var el = $('opening-brief');
    var openingActive = game.opening && game.turn <= game.opening.untilTurn;
    el.classList.toggle('hidden', !openingActive);
    if (!openingActive) return;
    el.textContent = isChinese()
      ? '灰烬涌动 · ' + routeName(game.opening.route) + ' · 已补给地块 +1 肥沃度 · 至第 ' + game.opening.untilTurn + ' 回合'
      : 'ASH SURGE · ' + game.opening.route + ' ROUTE · +1 SUPPLIED FERTILITY · THROUGH T' + game.opening.untilTurn;
  }

  function renderMods() {
    var box = $('modlist');
    box.innerHTML = '';
    var m = game.mods;
    function tag(txt) { var d = document.createElement('div'); d.className = 'mod'; d.textContent = txt; box.appendChild(d); }
    if (m.ashfall > 0) tag(isChinese() ? '灰烬落下 · 进攻费用翻倍 · ' + m.ashfall + ' 回合' : 'ASHFALL · raids cost double · ' + m.ashfall + 'T');
    if (m.rockCooled > 0) tag(isChinese() ? '岩层冷却 · 高度不再提供防御 · ' + m.rockCooled + ' 回合' : 'ROCK COOLED · height gives nothing · ' + m.rockCooled + 'T');
    if (m.storm > 0) tag(isChinese() ? '风暴 · 天气偏向落后方 · ' + m.storm + ' 回合' : 'STORM · the weather favours the loser · ' + m.storm + 'T');
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

  function currentTask() {
    if (game.pressure && game.pressure.bridgeTurns > 0) {
      return isChinese()
        ? '当前任务：中央临时横桥已开启，双方可在 ' + game.pressure.bridgeTurns + ' 回合内争夺机会。'
        : 'CURRENT TASK: The temporary central crossing is open — contest it in ' + game.pressure.bridgeTurns + ' turns.';
    }
    if (!orders.length && game.turn <= 2) {
      return isChinese()
        ? '当前任务：选择北路或南路，点击发光地块完成扩张。'
        : 'CURRENT TASK: Choose NORTH or SOUTH, then Claim a glowing tile.';
    }
    if (!orders.length && !game.tiles[game.beacon].owner) {
      return isChinese()
        ? '当前任务：向 Beacon 或附近 Relay 推进，抢占下一处明确目标。'
        : 'CURRENT TASK: Advance toward the Beacon or a nearby Relay.';
    }
    return isChinese()
      ? '当前任务：保持 Beacon 有补给；需要突破时争夺 Relay 或寻找横桥机会。'
      : 'CURRENT TASK: Keep the Beacon supplied; contest Relays or use a crossing to break through.';
  }

  function renderFeed() {
    var task = $('current-task');
    var el = $('feed-log');
    var followLatest = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
    task.textContent = currentTask();
    el.innerHTML = '';
    game.feed.slice(-60).forEach(function (f) {
      var d = document.createElement('div');
      d.className = 'fe ' + (f.cls || '');
      d.innerHTML = '<span class="fe-t">T' + f.turn + '</span><span class="fe-x"></span>';
      d.querySelector('.fe-x').textContent = f.text;
      el.appendChild(d);
    });
    if (followLatest) el.scrollTop = el.scrollHeight;
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
      el.innerHTML = '<p class="panel-note" style="border:none">' +
        (isChinese() ? '暂无战报。Cinder 会在第 3 回合结算后苏醒。' : 'Nothing yet. The mountain wakes at the end of turn 3.') + '</p>';
      return;
    }
    el.innerHTML = '';
    game.chronicle.slice().reverse().forEach(function (c) {
      var d = document.createElement('div');
      d.className = 'ch-entry';

      var tag = c.predictionResult === 'hit' ? '<span class="tag hit">' + (isChinese() ? '预测成立' : 'PREDICTION HELD') + '</span>'
              : c.predictionResult === 'miss' ? '<span class="tag miss">' + (isChinese() ? '预测未成立' : 'PREDICTION WRONG') + '</span>'
              : c.predictionResult === 'refused' ? '<span class="tag miss">' + (isChinese() ? '事件被拒绝' : 'EVENT REFUSED') + '</span>'
              : '<span class="tag wait">' + (isChinese() ? '尚待验证' : 'NOT YET MEASURED') + '</span>';

      d.innerHTML =
        '<div class="ch-top">' +
          '<span class="ch-season">' + (isChinese() ? '赛季 ' + c.season + ' · 第 ' + c.fireTurn + ' 回合 · ' : 'SEASON ' + c.season + ' · TURN ' + c.fireTurn + ' · ') + (c.source || 'FALLBACK') + '</span>' +
          '<span class="ch-int">' + 'I'.repeat(c.intensity) + '</span>' +
          '<span class="ch-name">' + eventName(c.template) + '</span>' +
        '</div>' +
        '<div class="ch-body">' +
          '<div class="ch-msg"></div>' +
          '<div class="ch-why"></div>' +
          '<div class="ch-pred">' + tag + '<span class="pred-text"></span></div>' +
        '</div>';

      d.querySelector('.ch-msg').textContent = c.fired ? '“' + localizedEventMessage(c.template, c.message) + '”'
        : c.predictionResult === 'refused' ? '(' + c.message + ')'
        : (isChinese() ? '（预警，尚未触发）' : '(warned, not yet fired) ') + localizedWarning(c.template, c.region, c.warning);
      d.querySelector('.ch-why').textContent = localizedDecisionEvidence(c);
      d.querySelector('.pred-text').textContent = c.prediction.text + (c.measured ? ' — ' + c.measured : '');
      el.appendChild(d);
    });
  }

  // ------------------------------------------------------------- console
  function renderConsole() {
    var last = game.chronicle[game.chronicle.length - 1];
    $('con-report').textContent = localizedReading(last);
    $('con-reason').textContent = localizedDecisionEvidence(last);

    var healthLine = 'SERVER ' + (aiHealth.ready ? 'READY' : 'FALLBACK') +
      ' · ' + (aiHealth.model || 'openai/gpt-oss-120b') +
      (aiHealth.reason ? ' · ' + aiHealth.reason : '');
    var saltkinLine = 'SALTKIN ' + (saltkinAI.pending ? 'PENDING' : saltkinAI.source) +
      (saltkinAI.error ? ' · ' + saltkinAI.error : '') +
      (saltkinAI.latencyMs ? ' · ' + saltkinAI.latencyMs + 'ms' : '');
    var directorLine = 'DIRECTOR ' + (directorAudit ? directorAudit.source : 'SLEEPING') +
      (directorAudit && directorAudit.error ? ' · ' + directorAudit.error : '');
    var mockLine = 'MOCK PLAYER ' + (mockPlayerAI.pending ? 'PENDING' : mockPlayerAI.source) +
      (mockPlayerAI.error ? ' · ' + mockPlayerAI.error : '') +
      (mockPlayerAI.latencyMs ? ' · ' + mockPlayerAI.latencyMs + 'ms' : '');
    $('con-ai-status').textContent = [healthLine, saltkinLine, directorLine, mockLine].join('\n');
    $('con-ai-status').classList.toggle('fallback', !aiHealth.ready || saltkinAI.source === 'FALLBACK' ||
      (directorAudit && directorAudit.source === 'FALLBACK'));

    var doctrineText = saltkinAI.doctrine ? JSON.stringify(saltkinAI.doctrine, null, 2) : 'heuristic fallback';
    $('con-doctrine').textContent = doctrineText + '\n\nsource=' + saltkinAI.source +
      ' · used=' + saltkinAI.uses + '/3' + (saltkinAI.requestId ? ' · request=' + saltkinAI.requestId : '');
    var playerProfile = CF.profile.build(game, CF.profile.load());
    $('con-profile').textContent = JSON.stringify(playerProfile.features, null, 2) +
      '\n\nEVIDENCE\n' + JSON.stringify(playerProfile.evidence, null, 2);
    // The rail is a glanceable next-step surface. The full doctrine stays in
    // Cinder Console; show the opponent only once its plan has game evidence.
    var intentEl = $('saltkin-intent');
    var hasResolvedTurn = game.stats.length > 0;
    intentEl.classList.toggle('hidden', !hasResolvedTurn);
    if (hasResolvedTurn) {
      if (saltkinAI.doctrine) {
        intentEl.textContent = isChinese()
          ? '盐潮军 AI · ' + saltkinAI.doctrine.stance + ' / ' + saltkinAI.doctrine.objective
          : 'SALTKIN AI · ' + saltkinAI.doctrine.stance + ' / ' + saltkinAI.doctrine.objective;
      } else {
        intentEl.textContent = isChinese()
          ? '盐潮军 AI · 规则策略 · ' + lastBotMood
          : 'SALTKIN AI · FALLBACK · ' + lastBotMood;
      }
    }

    if (!directorAudit || !directorAudit.prepared) {
      $('con-candidates').textContent = isChinese() ? '尚未评估赛季候选。' : 'no season evaluated yet';
    } else {
      var prepared = directorAudit.prepared;
      var candidateLines = prepared.candidates.map(function (c) {
        return c.id + ' ' + eventName(c.event.template) + ' I'.repeat(c.event.intensity) + ' ' +
          (isChinese() ? eventRegion(c.event.region) : c.event.region.toUpperCase()) +
          (isChinese() ? ' · 进攻 ' : ' · raids ') + c.summary.raids_per_turn.median +
          (isChinese() ? ' · 夺取 ' : ' · captures ') + c.summary.captures.median +
          (isChinese() ? ' · 领地差 ' : ' · gap ') + c.summary.land_gap.median;
      });
      candidateLines.push('');
      candidateLines.push((isChinese() ? '对照基线 · ' : 'SHADOW · ') + eventName(prepared.baseline.template) +
        ' I'.repeat(prepared.baseline.intensity) + ' ' +
        (isChinese() ? eventRegion(prepared.baseline.region) : prepared.baseline.region.toUpperCase()));
      $('con-candidates').textContent = candidateLines.join('\n');
    }

    var p = game.pending;
    $('con-pending').textContent = p
      ? eventName(p.template) + (isChinese() ? ' · 强度 ' : ' · intensity ') + p.intensity +
        (p.region ? ' · ' + (isChinese() ? eventRegion(p.region) : EV.regionName(p.region)) : '') +
        (isChinese() ? ' · 将在第 ' + p.fireTurn + ' 回合末触发' : ' · fires at the end of turn ' + p.fireTurn)
      : (isChinese() ? '暂无待触发事件 · 对手当前策略：' + lastBotMood : 'none — the rival is playing ' + lastBotMood);

    $('con-mock-status').textContent = mockPlayerAI.pending
      ? (isChinese() ? '正在调用 ' : 'calling ') + (aiHealth.model || (isChinese() ? '已配置模型' : 'the configured model')) + '…'
      : mockPlayerAI.source === 'LLM' && mockPlayerAI.doctrine
        ? 'LLM · ' + mockPlayerAI.doctrine.stance + ' / ' + mockPlayerAI.doctrine.objective +
          ' · ' + mockPlayerAI.latencyMs + 'ms'
        : mockPlayerAI.source === 'FALLBACK'
          ? (isChinese() ? '降级策略 · ' : 'fallback · ') + mockPlayerAI.error +
            (isChinese() ? ' · 仅生成合法机器人指令' : ' · legal bot queue only')
          : (isChinese() ? '就绪 · 尚未生成模拟行动' : 'ready — no mock move queued');

    var mem = $('con-memory'), keys = Object.keys(game.memory);
    if (!keys.length) { mem.textContent = isChinese() ? '暂无事件历史。' : 'no history yet'; }
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
        row.title = isChinese()
          ? '预测成立 ' + m.hits + ' 次，未成立 ' + m.misses + ' 次'
          : m.hits + ' predictions right, ' + m.misses + ' wrong';
        mem.appendChild(row);
      });
    }
  }

  // ================================================================ input
  function bindUI() {
    var cv = $('map');

    // --- persistent, non-gameplay settings ---------------------------------
    // The menu lives in the top bar so the guide remains discoverable even
    // when the Orders rail is not the active panel.
    var settingsButton = $('btn-settings');
    var settingsMenu = $('settings-menu');
    function closeSettings() {
      settingsMenu.classList.add('hidden');
      settingsButton.setAttribute('aria-expanded', 'false');
    }
    settingsButton.onclick = function () {
      if (interactionLocked()) return;
      var isOpen = !settingsMenu.classList.contains('hidden');
      settingsMenu.classList.toggle('hidden', isOpen);
      settingsButton.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      if (!isOpen) $('settings-language').focus();
    };
    $('settings-tutorial').onclick = function () {
      closeSettings();
      if (CF.openTutorial) CF.openTutorial();
    };
    $('settings-language').onchange = function () { applyLanguage(this.value); };
    document.addEventListener('pointerdown', function (event) {
      if (!settingsMenu.classList.contains('hidden') &&
          !settingsMenu.contains(event.target) && !settingsButton.contains(event.target)) closeSettings();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !settingsMenu.classList.contains('hidden')) closeSettings();
    });
    applyLanguage(savedLanguage());

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
    $('con-mock').onclick = requestMockPlayerMove;

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
          /^(input|select|textarea)$/.test(tag) || (target && target.isContentEditable)) return;
      if (e.key === '1') { e.preventDefault(); setTool('expand'); }
      else if (e.key === '2') { e.preventDefault(); setTool('fortify'); }
      else if (e.key === '3') { e.preventDefault(); setTool('raid'); }
      else if (e.key === '4') { e.preventDefault(); toggleSupport(); }
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
      if (!hint) {
        var preview = fieldPreview();
        if (preview.commands >= E.fieldCommands(game)) hint = E.fieldCommands(game) + ' moves are already queued — resolve the turn to act again.';
        else if (tool === 'expand') hint = 'Not a Claim target — choose a glowing empty tile next to your land.';
        else if (tool === 'fortify') hint = 'Not a Hold target — choose one of your glowing supplied tiles.';
        else hint = 'Not an Attack target — choose a glowing enemy tile beside your land.';
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
