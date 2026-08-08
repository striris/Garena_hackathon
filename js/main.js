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
      'cinder.note': '',
      'cinder.runtime': 'AI RUNTIME', 'cinder.doctrine': 'SALTKIN DOCTRINE',
      'cinder.profile': 'PLAYER PROFILE · RESOLVED HISTORY ONLY',
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
      'guide.glow': '① glow = act', 'guide.supply': '② stay connected', 'guide.goal': '③ Relay cuts · Beacon wins',
      'intro.skip': 'SKIP', 'intro.back': 'BACK',
      'intro.hero.kicker': 'THE ASH RING · SEASON 1',
      'intro.hero.line': 'A world that refuses to sit still.',
      'intro.hero.sub1': 'Claim ground, break a supply line, and hold the Beacon.',
      'intro.hero.sub2': 'Cinder answers the resolved battle with fair, visible shifts in the field.',
      'intro.hero.you': '· you', 'intro.hero.rival': '· rival', 'intro.hero.world': '· Cinder',
      'intro.map.kicker': '1 / 2 · READ THE FIELD',
      'intro.map.title': 'Read the field. Choose your path.',
      'intro.map.north': 'NORTH →', 'intro.map.south': 'SOUTH →', 'intro.map.relay': '② RELAY', 'intro.map.beacon': '③ BEACON',
      'intro.map.capitalYou': '① YOU', 'intro.map.capitalRival': 'RIVAL',
      'intro.map.flowStart': '① leave your capital', 'intro.map.flowRelay': '② claim a Relay pair', 'intro.map.flowBeacon': '③ keep Beacon supplied',
      'intro.map.keyCapital': 'gold / red frame = capital', 'intro.map.keyRelay': 'gold double tile = Relay', 'intro.map.keyBeacon': 'orange flame = Beacon',
      'intro.map.attributes': 'Top-left pips show Height: each point adds 1 Defence. Green glow shows Fertility: it provides Supply while connected to your capital.',
      'intro.map.caption': 'Build a path → contest a Relay → hold the Beacon.',
      'intro.map.step1.title': 'The field has two main routes.', 'intro.map.step1.body': 'Both capitals connect to North and South. The central caldera does not create a third route.',
      'intro.map.step2.title': 'Relay disrupts; Beacon scores.', 'intro.map.step2.body': 'Capture both tiles in a Relay pair to cut supply beyond it. A Beacon scores only while it remains supplied.',
      'intro.map.step3.title': 'Commit, then adapt.', 'intro.map.step3.body': 'Open a continuous path on one route before contesting an objective. You may switch routes next turn.',
      'intro.economy.kicker': '2 / 2 · PLAY A TURN', 'intro.economy.title': 'Issue orders. Resolve together.',
      'intro.economy.income': 'SUPPLIED FERTILITY', 'intro.economy.incomeSub': 'to spend',
      'intro.economy.claim': 'CLAIM', 'intro.economy.attack': 'ATTACK', 'intro.economy.hold': 'HOLD',
      'intro.economy.unspent': '2 unspent', 'intro.economy.reserve': '2 RESERVE',
      'intro.economy.caption': 'Moves limit orders; Supply pays their cost.',
      'intro.economy.visual1.title': 'Choose a command', 'intro.economy.visual1.body': 'Claim 3 · Hold 2 · Attack 1',
      'intro.economy.visual2.title': 'Select a valid tile', 'intro.economy.visual2.body': 'A glow marks a legal target.',
      'intro.economy.visual3.title': 'Commit the turn', 'intro.economy.visual3.body': 'Both sides resolve together.',
      'intro.economy.claimHint': 'take adjacent empty land', 'intro.economy.holdHint': '+1 strength on supplied land', 'intro.economy.attackHint': 'attack adjacent enemy land',
      'intro.economy.step1.title': 'Moves · order capacity', 'intro.economy.step1.body': 'Each queued command spends one Move. At 0, no further commands can be issued this turn.',
      'intro.economy.step2.title': 'Supply · spending capacity', 'intro.economy.step2.body': 'Supply pays the printed cost. If it is insufficient, that command is unavailable; unused income becomes Reserve.',
      'intro.economy.step3.title': 'Resolve · simultaneous outcome', 'intro.economy.step3.body': 'Both queues reveal together, so neither side has first-mover advantage. Then scores and supply update.',
      'intro.effort.kicker': '3 / 5 · CHOOSE A FRONT', 'intro.effort.title': 'Focus one front this turn, then choose again.',
      'intro.effort.now': 'THIS TURN: NORTH', 'intro.effort.next': 'CHOOSE AGAIN NEXT TURN', 'intro.effort.cap': 'CAP', 'intro.effort.relay': 'RELAY',
      'intro.effort.combo': 'COMBO LIGHTS UP', 'intro.effort.comboSub': 'linked orders can buy a stronger follow-through',
      'intro.effort.nextLabel': 'Next turn:', 'intro.effort.nextChoice': 'CHOOSE NORTH OR SOUTH AGAIN',
      'intro.effort.step1.title': "Your first route action chooses this turn's front.", 'intro.effort.step1.body': 'Claim, Hold and Attack stay on North or South for this turn only.',
      'intro.effort.step2.title': 'Chain a clear advance.', 'intro.effort.step2.body': 'Two connected Claims or two supplied attacks on one target make Combo available.',
      'intro.effort.step3.title': 'Combo is optional.', 'intro.effort.step3.body': 'Use it for a stronger follow-through, or save that Supply as Reserve.',
      'intro.effort.step4.title': 'There is no third route.', 'intro.effort.step4.body': 'The central-side squares are ordinary North or South land; choose either route again next turn.',
      'intro.combat.kicker': '3 / 3 · RESOLVE AND SURVIVE', 'intro.combat.title': 'Win fights, keep your line supplied.',
      'intro.combat.str2': 'STR 2', 'intro.combat.str4': 'STR 4', 'intro.combat.high1': 'HIGH 1', 'intro.combat.sources': 'SUPPLIED SOURCES',
      'intro.combat.coordination': '+2 COORDINATION', 'intro.combat.siege': '+1 COMBO',
      'intro.combat.relayTaken': 'RELAY PAIR TAKEN', 'intro.combat.noIncome': 'NO INCOME', 'intro.combat.noHold': 'NO HOLD', 'intro.combat.decay': 'STR −1 / TURN',
      'intro.combat.visualTitle': 'READ THE RESULT',
      'intro.combat.visual1.title': 'Attack wins when its number is higher.', 'intro.combat.visual1.body': 'Strength + 3 must beat Strength + Height.',
      'intro.combat.visual2.title': 'A full Relay pair cuts Supply.', 'intro.combat.visual2.body': 'Cut-off land cannot Hold and weakens each turn.',
      'intro.combat.visual3.title': 'A supplied Beacon scores.', 'intro.combat.visual3.body': 'Reach 10 points first, or lead in land after turn 25.',
      'intro.combat.step1.title': 'Attack only needs one comparison.', 'intro.combat.step1.body': 'Source strength + 3 must beat target strength + height. Two supplied sources on one target gain +2.',
      'intro.combat.step2.title': 'Relay cuts the line home.', 'intro.combat.step2.body': 'Take both tiles in a Relay pair to isolate land beyond it. Cut-off land gives no Supply, cannot Hold and loses strength.',
      'intro.combat.step3.title': 'Resolve together, then react.', 'intro.combat.step3.body': 'Both sides reveal at once. Cinder warns before changing the field; reach 10 supplied Beacon points, or hold more land after turn 25.',
      'intro.ai.kicker': '5 / 5 · CINDER SHIFTS THE FIELD', 'intro.ai.title': 'Cinder creates a fair new decision.',
      'intro.ai.queue': 'QUEUE', 'intro.ai.queueSub': '1 / 2 / 3 + map', 'intro.ai.saltkinSub': 'secret orders',
      'intro.ai.resolve': 'RESOLVE', 'intro.ai.resolveSub': 'simultaneous', 'intro.ai.turn2': 'TURN 2',
      'intro.ai.warning': '⚠ WARNING · NORTH COAST', 'intro.ai.turn3': 'TURN 3', 'intro.ai.acts': 'CINDER ACTS',
      'intro.ai.victory': '10 SUPPLIED BEACON POINTS', 'intro.ai.victorySub': 'or most land after 25 resolved turns',
      'intro.ai.step1.title': 'Play first; the rival cannot see your queued moves.', 'intro.ai.step1.body': 'When you end the turn, both sides resolve together.',
      'intro.ai.step2.title': 'Every third turn, Cinder signals a change.', 'intro.ai.step2.body': 'It reads the resolved battle, gives a visible warning, then changes the field on the following turn.',
      'intro.ai.step3.title': 'The change is constrained and fair.', 'intro.ai.step3.body': 'Capitals and Relays are protected; Cinder cannot erase the routes between both sides.',
      'intro.ai.claim': 'Claim', 'intro.ai.hold': 'Hold', 'intro.ai.attack': 'Attack', 'intro.ai.combo': 'Combo', 'intro.ai.end': 'End turn', 'intro.ai.clear': 'Clear queue'
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
      'cinder.note': '',
      'cinder.runtime': 'AI 运行状态', 'cinder.doctrine': '盐潮军策略（模型原始输出）',
      'cinder.profile': '玩家画像 · 仅使用已结算历史',
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
      'guide.glow': '① 跟随发光边框行动', 'guide.supply': '② 保持与首都连通', 'guide.goal': '③ Relay 断补给 · Beacon 得分',
      'intro.skip': '跳过', 'intro.back': '返回',
      'intro.hero.kicker': '灰烬之环 · 第一季',
      'intro.hero.line': '一座永不静止的火山群岛。',
      'intro.hero.sub1': '扩张领地、切断补给线，并守住 Beacon。',
      'intro.hero.sub2': 'Cinder 会根据已结算的战局，为双方带来公平且可预期的战场变化。',
      'intro.hero.you': '· 我方', 'intro.hero.rival': '· 对手', 'intro.hero.world': '· Cinder',
      'intro.map.kicker': '1 / 2 · 认识战场',
      'intro.map.title': '读懂战场，再决定路线。',
      'intro.map.north': '北路 →', 'intro.map.south': '南路 →', 'intro.map.relay': '② Relay', 'intro.map.beacon': '③ Beacon',
      'intro.map.capitalYou': '① 我方', 'intro.map.capitalRival': '对手',
      'intro.map.flowStart': '① 从首都出发', 'intro.map.flowRelay': '② 占领一组 Relay', 'intro.map.flowBeacon': '③ 保持 Beacon 补给',
      'intro.map.keyCapital': '金 / 红边框 = 首都', 'intro.map.keyRelay': '金色双格 = Relay', 'intro.map.keyBeacon': '橙色火焰 = Beacon',
      'intro.map.attributes': '地块左上角刻度为高度：每点提高 1 点防守；绿色光晕为肥沃度：与首都连通时提供 Supply。',
      'intro.map.caption': '建立路径 → 争夺 Relay → 守住 Beacon。',
      'intro.map.step1.title': '战场由两条主路构成。', 'intro.map.step1.body': '双方首都都可通往北路和南路；中央区域不构成独立路线。',
      'intro.map.step2.title': 'Relay 断补给，Beacon 得分。', 'intro.map.step2.body': '占领同组两格 Relay，即可切断其后方补给；Beacon 只有保持补给连通时才会得分。',
      'intro.map.step3.title': '先形成推进线，再争夺目标。', 'intro.map.step3.body': '一回合内专注一路，优先建立连续领地；下回合可根据局势切换路线。',
      'intro.economy.kicker': '2 / 2 · 进行一回合', 'intro.economy.title': '下达指令，同步结算。',
      'intro.economy.income': '已补给肥沃度', 'intro.economy.incomeSub': '可供花费',
      'intro.economy.claim': '扩张', 'intro.economy.attack': '进攻', 'intro.economy.hold': '固守',
      'intro.economy.unspent': '剩余 2 点', 'intro.economy.reserve': '储备 2 点',
      'intro.economy.caption': '行动次数限制指令数；Supply 支付它们的消耗。',
      'intro.economy.visual1.title': '选择指令', 'intro.economy.visual1.body': '扩张 3 · 固守 2 · 进攻 1',
      'intro.economy.visual2.title': '选择有效目标', 'intro.economy.visual2.body': '发光边框表示该地块可执行当前指令。',
      'intro.economy.visual3.title': '提交回合', 'intro.economy.visual3.body': '双方指令会同时结算。',
      'intro.economy.claimHint': '占领相邻的空地', 'intro.economy.holdHint': '强化一格有补给的领地', 'intro.economy.attackHint': '进攻相邻的敌方领地',
      'intro.economy.step1.title': '行动次数 · 指令容量', 'intro.economy.step1.body': '每排入一条指令都会消耗 1 次行动；行动次数归零后，本回合不能再下达指令。',
      'intro.economy.step2.title': 'Supply · 资源容量', 'intro.economy.step2.body': 'Supply 支付按钮显示的消耗。Supply 不足时指令不可用；未花完的收入会转为 Reserve。',
      'intro.economy.step3.title': '同步结算 · 公平结果', 'intro.economy.step3.body': '双方队列会同时揭示与结算，没有先手优势；随后更新得分与补给状态。',
      'intro.effort.kicker': '3 / 5 · 选择战线', 'intro.effort.title': '本回合专注一路，下回合重新选择。',
      'intro.effort.now': '本回合：北路', 'intro.effort.next': '下回合可重新选择', 'intro.effort.cap': '首都', 'intro.effort.relay': 'Relay',
      'intro.effort.combo': '连携已解锁', 'intro.effort.comboSub': '关联指令可购买更强的后续效果',
      'intro.effort.nextLabel': '下回合：', 'intro.effort.nextChoice': '可再次选择北路或南路',
      'intro.effort.step1.title': '本回合第一条战线指令决定主攻路线。', 'intro.effort.step1.body': '扩张、固守和进攻在本回合内必须留在北路或南路其中一路。',
      'intro.effort.step2.title': '连成一次清楚的推进。', 'intro.effort.step2.body': '两次连续扩张，或两格有补给领地进攻同一目标，都会解锁连携。',
      'intro.effort.step3.title': '连携是可选项。', 'intro.effort.step3.body': '可用它强化后续效果，也可以把 Supply 留作 Reserve。',
      'intro.effort.step4.title': '没有第三条路线。', 'intro.effort.step4.body': '靠近中央的地图块也是普通北路或南路领地；下回合可自由换路。',
      'intro.combat.kicker': '3 / 3 · 同步结算与生存', 'intro.combat.title': '赢下战斗，守住补给线。',
      'intro.combat.str2': '强度 2', 'intro.combat.str4': '强度 4', 'intro.combat.high1': '高地 1', 'intro.combat.sources': '有补给的进攻来源',
      'intro.combat.coordination': '+2 协同', 'intro.combat.siege': '+1 连携',
      'intro.combat.relayTaken': '占领 Relay 双格', 'intro.combat.noIncome': '无收入', 'intro.combat.noHold': '无法固守', 'intro.combat.decay': '每回合强度 −1',
      'intro.combat.visualTitle': '怎么看结算结果',
      'intro.combat.visual1.title': '进攻数值更高即可获胜。', 'intro.combat.visual1.body': '来源强度 + 3 必须高于目标强度 + 地形高度。',
      'intro.combat.visual2.title': '占领完整 Relay 双格可切断补给。', 'intro.combat.visual2.body': '断补给领地不能固守，且每回合都会变弱。',
      'intro.combat.visual3.title': '有补给的 Beacon 才会得分。', 'intro.combat.visual3.body': '先获得 10 分，或第 25 回合后领地更多即可获胜。',
      'intro.combat.step1.title': '进攻只需一次数值比较。', 'intro.combat.step1.body': '来源强度 + 3 必须高于目标强度 + 地形高度；两格有补给领地进攻同一目标可得 +2。',
      'intro.combat.step2.title': 'Relay 会切断回家的补给线。', 'intro.combat.step2.body': '占领同组两格 Relay 可隔离其后的领地；断补给领地不产 Supply、不能固守且会失去强度。',
      'intro.combat.step3.title': '同步结算，再作应对。', 'intro.combat.step3.body': '双方指令同时揭示。Cinder 会先预警再改变战场；先获得 10 点已补给 Beacon 分，或第 25 回合后占有更多领地即可获胜。',
      'intro.ai.kicker': '5 / 5 · CINDER 改变战场', 'intro.ai.title': 'Cinder 会带来公平的新选择。',
      'intro.ai.queue': '排队', 'intro.ai.queueSub': '操作 1 / 2 / 3 + 点地图', 'intro.ai.saltkinSub': '秘密指令',
      'intro.ai.resolve': '结算', 'intro.ai.resolveSub': '同时发生', 'intro.ai.turn2': '第 2 回合',
      'intro.ai.warning': '⚠ 预警 · 北岸', 'intro.ai.turn3': '第 3 回合', 'intro.ai.acts': 'CINDER 行动',
      'intro.ai.victory': '10 点已补给的 Beacon 分', 'intro.ai.victorySub': '或第 25 回合后占有更多领地',
      'intro.ai.step1.title': '先下指令；对手看不到你的队列。', 'intro.ai.step1.body': '结束回合后，双方指令会同时结算。',
      'intro.ai.step2.title': '每三回合，Cinder 会预告一次变化。', 'intro.ai.step2.body': '它读取已结算的战局，先给出可见预警，再于下一回合改变战场。',
      'intro.ai.step3.title': '变化受约束，也保持公平。', 'intro.ai.step3.body': '首都与 Relay 受到保护；Cinder 不会抹除双方之间的全部路线。',
      'intro.ai.claim': '扩张', 'intro.ai.hold': '固守', 'intro.ai.attack': '进攻', 'intro.ai.combo': '连携', 'intro.ai.end': '结束回合', 'intro.ai.clear': '清空队列'
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
      stages: ['Tracing supplied routes.', 'Weighing NORTH against SOUTH.', 'Counting exposed Relays.', 'Writing a doctrine.'],
      zh: { kicker: '盐潮军议事厅', title: '正在读取已结算战局',
        stages: ['追踪仍有补给的领地。', '比较北路与南路。', '评估可争夺的 Relay。', '拟定本回合策略。'] }
    },
    orders: {
      kicker: 'SALTKIN COMMAND TENT', title: 'Sealing the rival orders',
      stages: ['Placing the first command stone.', 'Testing the current front.', 'Funding any operation support.', 'Both envelopes are now sealed.'],
      zh: { kicker: '盐潮军指挥帐', title: '正在封存双方指令',
        stages: ['部署第一条指令。', '检验当前战线。', '检查是否启用连携。', '双方指令已封存。'] }
    },
    director: {
      kicker: 'CINDER STIRS', title: 'The mountain reads the battle',
      stages: ['Reading the battle already fought.', 'Feeling the pressure points.', 'Weighing a fair new opportunity.', 'Writing a warning for both sides.'],
      zh: { kicker: '火山正在苏醒', title: '正在读取战局',
        stages: ['读取已发生的对抗。', '定位僵持与压力点。', '比较公平的新机会。', '向双方发出预警。'] }
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
    var baseCopy = THINKING_COPY[wait.kind] || THINKING_COPY.orders;
    var copy = isChinese() && baseCopy.zh ? baseCopy.zh : baseCopy;
    var elapsed = Math.max(0, Date.now() - wait.startedAt);
    var stage = Math.floor(elapsed / 1350) % copy.stages.length;
    $('thinking-kicker').textContent = wait.kicker || copy.kicker;
    $('thinking-title').textContent = wait.title || copy.title;
    $('thinking-detail').textContent = wait.detail || copy.stages[stage];
    $('thinking-elapsed').textContent = wait.footer ||
      (isChinese() ? '正在处理，操作暂时锁定 · 已等待 ' + Math.floor(elapsed / 1000) + ' 秒'
        : 'The command table is locked · ' + Math.floor(elapsed / 1000) + 's elapsed');
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
    // The guide follows the actual play loop. It remains visual and short,
    // but all six pages are available on the first opening as well as from
    // Settings, so no hidden tutorial pages contradict the live rules.
    var allSlides = [].slice.call(el.querySelectorAll('.slide'));
    var slides = [allSlides[0], allSlides[1], allSlides[2]];
    function copy(key) { return (UI_COPY[language] && UI_COPY[language][key]) || UI_COPY.en[key] || key; }

    CF.intro.init($('introcanvas'));

    // The guide deliberately reuses the live board instead of another abstract
    // diagram.  It is a frozen, darkened view of this match's actual map with
    // only the six first-time-player labels layered on top.
    function paintGuideMap() {
      var target = $('guide-map-canvas'), source = $('map');
      if (!target || !source || !game) return;
      var box = target.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      target.width = Math.max(1, Math.round(box.width * dpr));
      target.height = Math.max(1, Math.round(box.height * dpr));
      var ctx = target.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#08111d';
      ctx.fillRect(0, 0, box.width, box.height);
      var sourceRatio = source.width / Math.max(1, source.height);
      var targetRatio = box.width / box.height;
      var dw = targetRatio > sourceRatio ? box.height * sourceRatio : box.width;
      var dh = targetRatio > sourceRatio ? box.height : box.width / sourceRatio;
      var dx = (box.width - dw) / 2, dy = (box.height - dh) / 2;
      ctx.globalAlpha = 0.82;
      ctx.drawImage(source, dx, dy, dw, dh);
      ctx.globalAlpha = 1;

      function place(name, tiles, nudgeX, nudgeY) {
        var node = el.querySelector('[data-guide-label="' + name + '"]');
        if (!node || !tiles || !tiles.length) return;
        var x = 0, y = 0;
        tiles.forEach(function (index) {
          var r = R.tileRect(index);
          x += r.x + r.s / 2;
          y += r.y + r.s / 2;
        });
        x /= tiles.length; y /= tiles.length;
        var targetX = dx + (x / Math.max(1, R.geom.w)) * dw;
        var targetY = dy + (y / Math.max(1, R.geom.h)) * dh;
        var labelX = targetX + (nudgeX || 0), labelY = targetY + (nudgeY || 0);
        node.style.left = labelX + 'px';
        node.style.top = labelY + 'px';
        var line = el.querySelector('[data-guide-line="' + name + '"]');
        if (line) {
          line.setAttribute('x1', (labelX / box.width * 100));
          line.setAttribute('y1', (labelY / box.height * 100));
          line.setAttribute('x2', (targetX / box.width * 100));
          line.setAttribute('y2', (targetY / box.height * 100));
        }
      }
      function routeGuide(name, row, labelColumn, labelOffsetY) {
        var from = R.tileRect(row * game.W + 2);
        var to = R.tileRect(row * game.W + (game.W - 3));
        var labelTile = R.tileRect(row * game.W + labelColumn);
        var lower = R.tileRect((row + 1) * game.W + 6);
        var y = (from.y + from.s / 2 + lower.y + lower.s / 2) / 2;
        var x1 = from.x + from.s / 2, x2 = to.x + to.s / 2;
        var px1 = dx + (x1 / Math.max(1, R.geom.w)) * dw;
        var px2 = dx + (x2 / Math.max(1, R.geom.w)) * dw;
        var py = dy + (y / Math.max(1, R.geom.h)) * dh;
        var tag = el.querySelector('[data-guide-label="' + name + '"]');
        var line = el.querySelector('.guide-route-arrows .' + name);
        if (tag) {
          tag.style.left = (dx + ((labelTile.x + labelTile.s / 2) / Math.max(1, R.geom.w)) * dw) + 'px';
          tag.style.top = (py + labelOffsetY) + 'px';
        }
        if (line) line.setAttribute('d', 'M ' + (px1 / box.width * 100) + ' ' + (py / box.height * 100) + 'H ' + (px2 / box.width * 100));
      }
      // North and South labels use mirrored positions on their actual route
      // tiles: north above the right half, south below the left half.
      routeGuide('north', 2, 10, -22);
      routeGuide('south', 6, 3, 22);
      place('capital-a', [game.capitals[1]], -26, -26);
      place('capital-b', [game.capitals[2]], 26, -26);
      // The marked Relay is the exact NW two-tile pair. Beacon placement
      // flips by route so its callout never competes with the route label.
      place('relay', game.relays.NW || game.relays.NE, 0, -30);
      var beaconNorth = game.tiles[game.beacon].route === 'north';
      place('beacon', [game.beacon], beaconNorth ? 30 : -30, beaconNorth ? 30 : -30);
    }

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
        ? ['查看地图 <kbd>→</kbd>', '了解操作 <kbd>→</kbd>', '开始游戏 <kbd>⏎</kbd>']
        : ['READ THE MAP <kbd>→</kbd>', 'HOW TO PLAY <kbd>→</kbd>', 'START PLAYING <kbd>⏎</kbd>'];
      $('intro-next').innerHTML = labels[slide];
      if (CF.intro.setScene) CF.intro.setScene(+slides[slide].dataset.slide);
      if (slide === 1) {
        paintGuideMap();
        window.setTimeout(paintGuideMap, 180);
      }
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
        title: isChinese() ? '信号中断，规则策略接管' : 'Signal lost — field doctrine takes over',
        detail: isChinese() ? '盐潮军将继续使用确定性策略，不会获得隐藏优势。' : 'The deterministic Saltkin commander will continue without hidden advantages.',
        footer: isChinese() ? '已明确展示降级；本回合仍可复现。' : 'Fallback is explicit; the turn remains reproducible.'
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
    beginAIWait('mock-player', 'orders', isChinese()
      ? '模拟玩家正在选择打法；规则引擎随后会生成合法操作。'
      : 'Mock Player is choosing a doctrine; rules will generate the legal moves.');
    refresh();

    CF.ai.mockPlayer(payload).then(function (response) {
      if (!game || matchId !== requestMatch.split('-mock-')[0] || game.turn !== snapshotTurn ||
          response.matchId !== requestMatch || response.snapshotTurn !== snapshotTurn) return;
      var plan = CF.bot.plan(game, 1, false, response.decision);
      orders = plan.orders.slice();
      supportRequested = !!plan.orders.support;
      var summary = orders.map(function (o) {
        return o.type === 'raid' ? 'Attack ' + E.coord(game, o.from) + '→' + E.coord(game, o.to)
          : U.cap(o.type) + ' ' + E.coord(game, o.to);
      }).join(' + ') || 'no legal move';
      mockPlayerAI = {
        pending: false, doctrine: response.decision, source: response.meta.source || 'LLM',
        model: response.meta.model || null, latencyMs: response.meta.latencyMs || 0, error: null,
        orderSummary: summary
      };
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
        error: (err && err.code) || 'request_failed',
        orderSummary: fallback.orders.length ? (isChinese() ? '已生成可执行的默认操作队列。' : 'A legal default order queue was generated.') : (isChinese() ? '当前没有可执行操作。' : 'No legal action is available right now.')
      };
      say('a', mockPlayerAI.error === 'network_error'
        ? 'MOCK PLAYER could not reach the local AI service. A deterministic legal move was queued.'
        : 'MOCK PLAYER fallback (' + mockPlayerAI.error + ') queued a deterministic legal move.');
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
      say('', isChinese()
        ? '连携还需要 ' + E.SUPPORT_COST + ' 点 Supply；当前计划合计需要 ' + plan.total + ' 点。'
        : 'Operation Support needs ' + E.SUPPORT_COST + ' more supply; this plan would cost ' + plan.total + '.');
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
      detail: isChinese() ? '指令已封存，双方将同时结算。' : 'Orders sealed · resolving both command envelopes together.',
      footer: isChinese() ? '双方均看不到对方本回合的指令队列。' : 'No side sees the other side’s current queue.'
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
      if (p && paused) say('world', isChinese()
        ? '世界变化已暂停：' + eventName(p.template) + '正在等待触发。'
        : 'Director paused. ' + EV.nameOf(p.template) + ' is held at the gate.');
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
        detail: isChinese()
          ? '正在根据当前地图比较 ' + prepared.candidates.length + ' 个安全机会。'
          : 'Testing ' + prepared.candidates.length + ' safe candidate' +
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
        title: isChinese() ? '世界规则正在安全接管' : 'Cinder falls back safely',
        detail: isChinese() ? '本次世界策略未及时返回，已使用经过校验的安全机会继续对局。' : fallbackMessage,
        footer: isChinese() ? '确定性规则仍拥有最终裁定权。' : 'The deterministic validator remains authoritative.'
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
    say('world', isChinese()
      ? '火山正在苏醒：' + localizedWarning(ev.template, ev.region, ev.warning)
      : 'Cinder stirs. ' + ev.warning);
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
    banner(isChinese() ? eventName(ev.template) : EV.nameOf(ev.template),
      isChinese() ? localizedEventMessage(ev.template, out.message) : out.message);
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
    renderRouteGuides();
    renderMockResult();
    renderMods();
    renderWarning();
    renderChronicleBrief();
    renderChronicleForecast();
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

  function renderMockResult() {
    var box = $('mock-result');
    var title = $('mock-result-title'), source = $('mock-result-source');
    var intent = $('mock-result-intent'), queued = $('mock-result-orders');
    box.classList.remove('fallback');
    if (mockPlayerAI.pending) {
      box.classList.remove('hidden');
      title.textContent = isChinese() ? '模拟玩家正在思考' : 'MOCK PLAYER IS THINKING';
      source.textContent = aiHealth.model || (isChinese() ? '已配置模型' : 'CONFIGURED MODEL');
      intent.textContent = isChinese() ? '模型正在选择打法；规则引擎随后会生成合法操作。' : 'The model is choosing a style; rules will generate the legal actions.';
      queued.textContent = '';
      return;
    }
    if (mockPlayerAI.source === 'IDLE') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (mockPlayerAI.source === 'LLM' && mockPlayerAI.doctrine) {
      title.textContent = isChinese() ? '模拟玩家提案' : 'MOCK PLAYER PROPOSAL';
      source.textContent = 'LLM' + (mockPlayerAI.latencyMs ? ' · ' + mockPlayerAI.latencyMs + 'ms' : '');
      intent.textContent = (isChinese() ? '策略：' : 'PLAN: ') + mockPlayerAI.doctrine.stance + ' / ' +
        mockPlayerAI.doctrine.objective + ' — ' + mockPlayerAI.doctrine.intent;
      queued.textContent = (isChinese() ? '已生成操作：' : 'LEGAL QUEUE: ') + (mockPlayerAI.orderSummary || '—');
      return;
    }
    box.classList.add('fallback');
    title.textContent = isChinese() ? '模拟玩家降级策略' : 'MOCK PLAYER FALLBACK';
    source.textContent = mockPlayerAI.error || 'fallback';
    intent.textContent = mockPlayerAI.error === 'network_error'
      ? (isChinese() ? '浏览器未连接到本地 AI 服务；请刷新页面后再试。已使用规则策略继续展示。' : 'The browser could not reach the local AI service. Refresh and try again; a rules-based plan is shown meanwhile.')
      : (isChinese() ? '本次模型结果不可用，已使用规则策略继续展示。' : 'The model response was unavailable; a rules-based plan is shown instead.');
    queued.textContent = mockPlayerAI.orderSummary || '';
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
    title.textContent = isChinese() ? '连携' : 'COMBO';
    detail.textContent = type
      ? (isChinese() ? '当前行动已形成连携，可获得更强的后续效果' : 'Your linked actions can gain a stronger follow-through')
      : (isChinese() ? '先完成关联行动后解锁' : 'Unlock after linked actions');
    if (type && !supportRequested && !affordable) {
      var shortfall = Math.max(0, spent() + E.SUPPORT_COST - E.availableBudget(game, 1));
      detail.textContent += isChinese() ? ' · 还差 ' + shortfall + ' Supply' : ' · need ' + shortfall + ' Supply';
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
        ? (isChinese() ? '本回合正在推进' : 'FOCUS THIS TURN')
        : isOpening
          ? (isChinese() ? '开局肥沃加成' : 'OPENING FERTILITY +1')
          : (isChinese() ? '可选战线' : 'AVAILABLE FRONT');
      el.innerHTML = label + '<span class="route-state">' + state + '</span>';
    });
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
      tag(isChinese() ? '火山压力 · 僵持 ' + game.pressure.staleTurns + ' 回合' : 'CINDER PRESSURE · stillness ' + game.pressure.staleTurns + 'T');
    var cut = 0;
    for (var i = 0; i < game.tiles.length; i++)
      if (game.tiles[i].owner === 1 && game.supply[i] !== 1) cut++;
    if (cut) tag(isChinese() ? cut + ' 格断供 · 正在衰弱' : U.plural(cut, 'square') + ' CUT OFF · starving');
  }

  function renderWarning() {
    var bar = $('warnbar');
    if (game.pressure && game.pressure.staleTurns >= 2) {
      bar.classList.remove('hidden');
      $('warn-title').textContent = isChinese() ? '预警 · 火山压力' : 'WARNING · CINDER PRESSURE';
      $('warn-sub').textContent = game.pressure.staleTurns >= 3
        ? (isChinese() ? '前线的过度防守正在崩解；继续僵持会削弱接敌地块。' : 'Overbuilt front lines are eroding. Continued stillness weakens contested strongholds.')
        : (isChinese() ? '连续两回合没有领地变化；火山正在对僵局施压。' : 'Two turns without territorial change. Cinder is applying pressure to the stalemate.');
      $('warn-count').textContent = isChinese() ? '压力 ' + game.pressure.staleTurns + ' 回合' : 'pressure ' + game.pressure.staleTurns;
      return;
    }
    bar.classList.add('hidden');
  }

  function say(cls, text) {
    game.feed.push({ turn: game.turn, cls: cls, text: text });
  }

  function currentTask() {
    if (!orders.length && game.turn <= 2) {
      return isChinese()
        ? '当前任务：选择北路或南路，点击发光地块扩张；下回合可重新选择路线。'
        : 'CURRENT TASK: Choose NORTH or SOUTH, Claim a glowing tile, then choose again next turn.';
    }
    if (orders.length) {
      var focus = fieldPreview().main || game.opening.route;
      return isChinese()
        ? '当前任务：继续在' + routeName(focus) + '推进；也可选择固守或进攻已有前线。'
        : 'CURRENT TASK: Continue on ' + focus + ', or Hold / Attack along your current front.';
    }
    if (!orders.length && !game.tiles[game.beacon].owner) {
      return isChinese()
        ? '当前任务：向 Beacon 或附近 Relay 推进，抢占下一处明确目标。'
        : 'CURRENT TASK: Advance toward the Beacon or a nearby Relay.';
    }
    return isChinese()
      ? '当前任务：保持 Beacon 有补给；需要突破时争夺同一路的 Relay。'
      : 'CURRENT TASK: Keep the Beacon supplied; contest a Relay on that front to break through.';
  }

  function localizedFeedText(text) {
    if (!isChinese()) return text;
    var side = function (name) { return name === 'Ashfarers' ? '灰烬旅团' : name === 'Saltkin' ? '盐潮军' : name; };
    var m;
    var eventIds = {
      ERUPTION: 'eruption', 'THE TIDE ANSWERS': 'tide', EARTHQUAKE: 'earthquake',
      'NEW ISLAND': 'new_island', ASHFALL: 'ashfall', BLOOM: 'bloom',
      'THE FIRE MOVES': 'beacon_move', 'THE ROCK COOLS': 'rock_cools',
      SETTLERS: 'settlers', 'STORM SEASON': 'storm'
    };
    if ((m = /^(.+?) — (.+)$/.exec(text)) && eventIds[m[1]]) {
      return eventName(eventIds[m[1]]) + '：' + localizedEventMessage(eventIds[m[1]], m[2]);
    }
    if (text === 'A ring of islands, and a mountain under them that has never once sat still.')
      return '环状群岛之下，火山从未真正沉寂。';
    if (text === 'The Ashfarers hold the west. The Saltkin hold the east. Cinder wakes at the end of turn 3.')
      return '灰烬旅团占据西侧，盐潮军占据东侧；火山将在第 3 回合末开始介入。';
    if ((m = /^ASH SURGE: the (NORTH|SOUTH) route gains \+1 supplied fertility through turn (\d+)\. Both sides are equally distant\.$/.exec(text)))
      return '灰潮涌动：' + routeName(m[1]) + '在第 ' + m[2] + ' 回合前，已补给地块额外获得 +1 肥沃度；双方距离相同。';
    if ((m = /^Saltkin doctrine: ([A-Z]+) · (.+)$/.exec(text)))
      return '盐潮军策略：' + m[1] + ' · ' + m[2];
    if ((m = /^Saltkin AI fallback \(([^)]+)\)\. Deterministic strategy remains active\.$/.exec(text)))
      return '盐潮军策略暂不可用（' + m[1] + '），已继续使用确定性规则策略。';
    if ((m = /^MOCK PLAYER · ([A-Z]+) \/ ([A-Z]+) — (.+) Queued: (.+)\.$/.exec(text)))
      return '模拟玩家 · ' + m[1] + ' / ' + m[2] + '：' + m[3] + ' 已生成操作：' + m[4] + '。';
    if (text === 'MOCK PLAYER could not reach the local AI service. A deterministic legal move was queued.')
      return '模拟玩家未能连接本地 AI 服务，已生成一组合法的确定性操作。';
    if ((m = /^(Ashfarers|Saltkin) fund march supply for a stronger follow-through\.$/.exec(text)))
      return side(m[1]) + '投入连携补给，强化连续扩张。';
    if ((m = /^(Ashfarers|Saltkin) bring siege support to their coordinated attack\.$/.exec(text)))
      return side(m[1]) + '为协同进攻投入连携支援。';
    if ((m = /^(Ashfarers|Saltkin) coordinate two supplied attacks on ([A-Z]\d+) \(\+([\d]+)(?: with siege support)?\)\.$/.exec(text)))
      return side(m[1]) + '从两处有补给的领地协同进攻 ' + m[2] + '（+' + m[3] + '）。';
    if ((m = /^(Ashfarers|Saltkin) break on ([A-Z]\d+) \((\d+) vs (\d+)\)\.$/.exec(text)))
      return side(m[1]) + '对 ' + m[2] + ' 的进攻被击退（' + m[3] + ' 对 ' + m[4] + '）。';
    if ((m = /^(Ashfarers|Saltkin) take ([A-Z]\d+)(?: from the (Ashfarers|Saltkin))?\.$/.exec(text)))
      return side(m[1]) + '夺取了 ' + m[2] + (m[3] ? '，原属' + side(m[3]) : '') + '。';
    if ((m = /^Both peoples reach ([A-Z]\d+)\. The (Ashfarers|Saltkin) brought more and hold it\.$/.exec(text)))
      return '双方同时抵达 ' + m[1] + '；' + side(m[2]) + '投入更多兵力并占领该地。';
    if ((m = /^(Ashfarers|Saltkin) continue their advance into ([A-Z]\d+)\.$/.exec(text)))
      return side(m[1]) + '继续推进至 ' + m[2] + '。';
    if ((m = /^(\d+) squares? cut off from home are wasting away\.$/.exec(text)))
      return m[1] + ' 格失去补给的领地正在衰弱。';
    if (text === 'CINDER PRESSURE: two turns without a territorial change. Overbuilt front lines begin to crack.')
      return '火山压力：连续两回合没有领地变化，过度防守的前线开始松动。';
    if ((m = /^Cinder Pressure strips one excess strength from (\d+) front-line squares?\.$/.exec(text)))
      return '火山压力削弱了 ' + m[1] + ' 格接敌地块的额外强度。';
    if ((m = /^The Beacon burns for the (Ashfarers|Saltkin)\. \((\d+)\/(\d+)\)$/.exec(text)))
      return 'Beacon 为' + side(m[1]) + '燃烧（' + m[2] + '/' + m[3] + '）。';
    if (text === 'The Beacon is cut off. It scores for nobody this turn.')
      return 'Beacon 已失去补给，本回合双方均不得分。';
    if (text === 'The sky opens again. Raids cost what they should.') return '天空重新放晴，进攻费用恢复正常。';
    if (text === 'The rock hardens. High ground shelters its holders once more.') return '岩层重新坚固，高地再次提供防御。';
    if (text === 'The storm season passes.') return '风暴季结束。';
    return text;
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
      d.querySelector('.fe-x').textContent = localizedFeedText(f.text);
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
  function renderChronicleBrief() {
    var el = $('chronicle-brief');
    var openingActive = game.opening && game.turn <= game.opening.untilTurn;
    el.classList.toggle('hidden', !openingActive);
    if (!openingActive) return;
    var route = game.opening.route;
    $('chronicle-brief-title').textContent = isChinese()
      ? '开局机会 · ' + routeName(route)
      : 'OPENING OPPORTUNITY · ' + route;
    $('chronicle-brief-copy').textContent = isChinese()
      ? '第 ' + game.opening.untilTurn + ' 回合前，双方在' + routeName(route) + '的已补给地块额外获得 +1 肥沃度。优先沿发光地块扩张，可更快积累 Supply。'
      : 'Through turn ' + game.opening.untilTurn + ', supplied tiles on ' + route + ' gain +1 Fertility for both sides. Expanding along the glow builds Supply faster.';
  }

  function renderChronicleForecast() {
    var el = $('chronicle-forecast'), p = game.pending;
    el.classList.toggle('hidden', !p);
    if (!p) return;
    $('chronicle-forecast-title').textContent = isChinese()
      ? '待触发事件 · ' + eventName(p.template) + ' · 强度 ' + 'I'.repeat(p.intensity)
      : 'PENDING EVENT · ' + EV.nameOf(p.template) + ' · INTENSITY ' + 'I'.repeat(p.intensity);
    $('chronicle-forecast-copy').textContent = localizedWarning(p.template, p.region, p.warning);
    var away = p.fireTurn - game.turn;
    $('chronicle-forecast-count').textContent = isChinese()
      ? (away <= 0 ? '将在本回合结算时触发' : away === 1 ? '将在本回合末触发' : '预计 ' + away + ' 回合后触发')
      : (away <= 0 ? 'Resolves this turn' : away === 1 ? 'Resolves at end of turn' : 'Expected in ' + away + ' turns');
  }

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
    $('con-reason').textContent = localizedDecisionEvidence(last);

    var playerProfile = CF.profile.build(game, CF.profile.load());
    renderPlayerProfile(playerProfile);
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

    $('con-mock-status').textContent = mockPlayerAI.pending
      ? (isChinese() ? '正在调用 ' : 'calling ') + (aiHealth.model || (isChinese() ? '已配置模型' : 'the configured model')) + '…'
      : mockPlayerAI.source === 'LLM' && mockPlayerAI.doctrine
        ? 'LLM · ' + mockPlayerAI.doctrine.stance + ' / ' + mockPlayerAI.doctrine.objective +
          ' · ' + mockPlayerAI.latencyMs + 'ms'
        : mockPlayerAI.source === 'FALLBACK'
          ? (isChinese() ? '降级策略 · ' : 'fallback · ') + mockPlayerAI.error +
            (isChinese() ? ' · 仅生成合法机器人指令' : ' · legal bot queue only')
          : (isChinese() ? '就绪 · 尚未生成模拟行动' : 'ready — no mock move queued');

  }

  function renderPlayerProfile(profile) {
    var box = $('con-profile');
    if (!box) return;
    box.innerHTML = '';
    var features = profile.features, evidence = profile.evidence;
    if (!evidence.resolved_turns) {
      box.textContent = isChinese()
        ? '完成一回合后，这里会根据已结算的行为形成战术观察。'
        : 'Resolve one turn to build a tactical reading from settled play.';
      return;
    }
    var summary = document.createElement('p');
    summary.className = 'profile-summary';
    summary.textContent = isChinese()
      ? '已基于 ' + evidence.resolved_turns + ' 个已结算回合生成；不会读取当前指令队列。'
      : 'Built from ' + evidence.resolved_turns + ' resolved turn' + (evidence.resolved_turns === 1 ? '' : 's') + '; the current queue is excluded.';
    box.appendChild(summary);
    function routeNameForProfile(route) {
      if (isChinese()) return route === 'NORTH' ? '偏好北路' : route === 'SOUTH' ? '偏好南路' : '双路均衡';
      return route === 'NORTH' ? 'North-focused' : route === 'SOUTH' ? 'South-focused' : 'Balanced routes';
    }
    function tacticName(tactic) {
      if (isChinese()) return tactic === 'EXPAND' ? '扩张优先' : tactic === 'FORTIFY' ? '固守优先' : tactic === 'RAID' ? '进攻优先' : '仍在观察';
      return tactic === 'EXPAND' ? 'Growth-first' : tactic === 'FORTIFY' ? 'Defence-first' : tactic === 'RAID' ? 'Attack-first' : 'Still observing';
    }
    function beaconFocus(ratio) {
      if (isChinese()) return ratio >= 0.35 ? '主动争夺' : ratio >= 0.15 ? '偶尔关注' : '尚未形成偏好';
      return ratio >= 0.35 ? 'Actively contested' : ratio >= 0.15 ? 'Occasionally contested' : 'No clear focus yet';
    }
    function supplyCare(ratio) {
      if (isChinese()) return ratio >= 0.18 ? '需留意补给' : '补给稳定';
      return ratio >= 0.18 ? 'Supply needs attention' : 'Supply remains stable';
    }
    var cards = isChinese()
      ? [['路线偏好', routeNameForProfile(features.preferred_arc)], ['当前风格', tacticName(profile.currentTactic)], ['Beacon 关注', beaconFocus(features.beacon_chase)], ['补给管理', supplyCare(features.supply_neglect)]]
      : [['ROUTE', routeNameForProfile(features.preferred_arc)], ['STYLE', tacticName(profile.currentTactic)], ['BEACON', beaconFocus(features.beacon_chase)], ['SUPPLY', supplyCare(features.supply_neglect)]];
    var grid = document.createElement('div');
    grid.className = 'profile-grid';
    cards.forEach(function (card) {
      var item = document.createElement('div');
      item.className = 'profile-card';
      var label = document.createElement('small');
      var value = document.createElement('b');
      label.textContent = card[0]; value.textContent = card[1];
      item.appendChild(label); item.appendChild(value); grid.appendChild(item);
    });
    box.appendChild(grid);
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
      if (!paused && !busy && !game.over && EV.isDue(game.pending, game.turn)) fireEvent(game.pending);
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
    $('con-fire').onclick = function () {
      if (interactionLocked()) return;
      if (!game.pending) { say('world', 'Nothing is queued yet.'); renderFeed(); return; }
      fireEvent(game.pending);
    };
    $('con-mock').onclick = requestMockPlayerMove;

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
      rows.push(['terrain', t.bridge
        ? (isChinese() ? '火山遗迹 · 不可通行' : 'caldera ruin · impassable')
        : (isChinese() ? '开阔水域' : 'open water')]);
    } else {
      rows.push(['holder', t.owner ? (isChinese() ? (t.owner === 1 ? '灰烬旅团' : t.owner === 2 ? '盐潮军' : '第三方') : E.SIDE[t.owner]) : (isChinese() ? '无主' : 'nobody')]);
      rows.push(['strength', t.str]);
      rows.push(['height', t.elev + (game.mods.rockCooled > 0 ? (isChinese() ? '（无防御加成）' : ' (giving nothing)') : '')]);
      rows.push(['fertility', t.fert + (t.crater ? (isChinese() ? ' · 灰烬土' : ' · ash') : '')]);
      rows.push(['defence', E.defenceValue(game, i)]);
      if (t.owner && t.owner !== 3 && game.supply[i] !== t.owner) rows.push(['supply', isChinese() ? '补给中断' : 'CUT OFF']);
      if (t.capital) rows.push(['', isChinese() ? '首都' : 'CAPITAL']);
      if (t.relay) rows.push(['relay', t.relay + (isChinese() ? ' · 补给中继' : ' · SUPPLY RELAY')]);
    }
    if (i === game.beacon) {
      var beaconSupplied = t.owner && game.supply[i] === t.owner;
      rows.push(['', isChinese()
        ? 'Beacon' + (t.owner && !beaconSupplied ? ' · 无补给 / 不得分' : '')
        : 'THE BEACON' + (t.owner && !beaconSupplied ? ' · NO SUPPLY / NO SCORE' : '')]);
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
          hint = isChinese()
            ? (coordinated ? '协同进攻 +2，来自 ' : '进攻来源：') + E.coord(game, src) + '：' + attack + ' 对 ' + E.defenceValue(game, i) +
              (attack > E.defenceValue(game, i) ? ' · 可夺取' : ' · 防守方守住')
            : (coordinated ? 'coordinated raid +2 from ' : 'raid from ') + E.coord(game, src) + ': ' +
              attack + ' against ' + E.defenceValue(game, i) +
              (attack > E.defenceValue(game, i) ? ' — it falls' : ' — it holds');
        }
      } else if (tool === 'expand') {
        var expandFrom = E.canExpand(game, 1, i, orders);
        if (expandFrom != null) {
          var chained = game.tiles[expandFrom].owner !== 1;
          hint = isChinese()
            ? (chained ? '连续扩张' : '扩张') + '消耗 ' + E.COST.expand + ' Supply，初始强度 1'
            : (chained ? 'continue advance' : 'settle') + ' for ' + E.COST.expand + ', starts at strength 1';
        }
      } else if (tool === 'fortify') {
        if (E.canFortify(game, 1, i) != null) hint = isChinese()
          ? '固守消耗 ' + E.COST.fortify + ' Supply → 强度 ' + Math.min(E.MAX_STRENGTH, t.str + E.FORTIFY_GAIN)
          : 'fortify for ' + E.COST.fortify + ' → strength ' + Math.min(E.MAX_STRENGTH, t.str + E.FORTIFY_GAIN);
      }
      if (!hint) {
        var preview = fieldPreview();
        if (preview.commands >= E.fieldCommands(game)) hint = isChinese()
          ? '已排满 ' + E.fieldCommands(game) + ' 次行动，请结算回合后继续。'
          : E.fieldCommands(game) + ' moves are already queued — resolve the turn to act again.';
        else if (tool === 'expand') hint = isChinese() ? '不可扩张：请选择与你领地相邻的发光空地。' : 'Not a Claim target — choose a glowing empty tile next to your land.';
        else if (tool === 'fortify') hint = isChinese() ? '不可固守：请选择己方有补给的发光地块。' : 'Not a Hold target — choose one of your glowing supplied tiles.';
        else hint = isChinese() ? '不可进攻：请选择与你领地相邻的发光敌方地块。' : 'Not an Attack target — choose a glowing enemy tile beside your land.';
      }
      if (t.relay && t.owner === 2) {
        var impact = E.relayImpact(game, 1, i);
        if (impact && (impact.tiles || impact.beacon)) {
          hint += (hint ? ' · ' : '') + (isChinese()
            ? '控制这组 Relay 可切断 ' + impact.tiles + ' 格盐潮军领地、' + impact.fertility + ' 点肥沃度' + (impact.beacon ? '与 Beacon 补给' : '')
            : 'controlling this Relay cuts ' + impact.tiles + ' Saltkin squares, ' + impact.fertility + ' fertility' + (impact.beacon ? ', and Beacon supply' : ''));
        }
      }
    }

    var rowLabels = isChinese() ? {
      terrain: '地形', holder: '归属', strength: '强度', height: '高度', fertility: '肥沃', defence: '防御', supply: '补给', relay: '中继'
    } : {};
    el.innerHTML = '<h4 style="color:' + (t.owner ? R.sideColor(t.owner) : '#9b92ad') + '">' + name + '</h4>' +
      rows.map(function (r) {
        return '<div class="tt-row"><span>' + (rowLabels[r[0]] || r[0]) + '</span><b>' + r[1] + '</b></div>';
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
