#!/usr/bin/env node
'use strict';

const port = Number(process.argv[2] || 9224);
const appUrl = process.argv[3] || 'http://127.0.0.1:8765/';

async function main() {
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const page = pages.find((entry) => entry.type === 'page');
  if (!page) throw new Error('No debuggable page found');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 640, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.navigate', { url: appUrl });
    for (let attempt = 0; attempt < 80; attempt++) {
      const ready = await send('Runtime.evaluate', {
        expression: "document.readyState === 'complete' && !!window.CF && !!CF.game && !!CF.render",
        returnByValue: true
      });
      if (ready.result.value) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (attempt === 79) throw new Error('Game did not finish loading');
    }

    const evaluated = await send('Runtime.evaluate', {
      expression: `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const nav = document.querySelector('.intro-nav');
        const next = document.getElementById('intro-next');
        const pageChecks = [];
        for (let page = 0; page < 4; page++) {
          const active = document.querySelector('.slide.active');
          const rect = nav.getBoundingClientRect();
          pageChecks.push({
            page,
            active: Number(active.dataset.slide),
            navVisible: rect.top >= 0 && rect.bottom <= innerHeight,
            nextVisible: next.getBoundingClientRect().bottom <= innerHeight,
            animatedVisual: page === 0 || !!active.querySelector('.lesson-visual')
          });
          if (page < 3) { next.click(); await sleep(30); }
        }
        const tutorial = {
          slides: document.querySelectorAll('.slide').length,
          progress: document.getElementById('intro-progress').textContent.trim(),
          pages: pageChecks,
          dotsAreButtons: Array.from(document.querySelectorAll('.dot-nav')).every((node) => node.tagName === 'BUTTON')
        };

        document.getElementById('intro-skip').click();
        await sleep(620);
        for (let attempt = 0; attempt < 100 && CF.game.interactionLocked; attempt++) await sleep(100);
        if (CF.game.interactionLocked) throw new Error('Initial doctrine did not unlock');

        document.getElementById('con-ai-fail').click();
        if (!CF.ai.simulateFailure) throw new Error('Failure simulation did not enable');
        CF.game.newGame(55555);
        for (let attempt = 0; attempt < 50 && CF.game.thinking !== 'doctrine'; attempt++) await sleep(100);
        const beforeLockedInput = {
          turn: CF.game.state.turn,
          stats: CF.game.state.stats.length,
          commands: document.getElementById('hud-command-used').textContent.trim()
        };
        const doctrineOverlay = {
          thinking: CF.game.thinking,
          visible: !document.getElementById('ai-thinking').classList.contains('hidden'),
          ariaBusy: document.getElementById('app').getAttribute('aria-busy'),
          endDisabled: document.getElementById('btn-end').disabled,
          toolDisabled: document.querySelector('.tool').disabled
        };

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const state = CF.game.state;
        let target = -1;
        for (let i = 0; i < state.tiles.length; i++) {
          if (CF.engine.canExpand(state, 1, i, []) != null) { target = i; break; }
        }
        const tile = CF.render.tileRect(target);
        const canvas = document.getElementById('map');
        const box = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          clientX: box.left + (tile.x + tile.s / 2) * box.width / canvas.clientWidth,
          clientY: box.top + (tile.y + tile.s / 2) * box.height / canvas.clientHeight
        }));
        const inputFrozen = beforeLockedInput.turn === CF.game.state.turn &&
          beforeLockedInput.stats === CF.game.state.stats.length &&
          beforeLockedInput.commands === document.getElementById('hud-command-used').textContent.trim();

        for (let attempt = 0; attempt < 55 && CF.game.interactionLocked; attempt++) await sleep(100);
        if (CF.game.interactionLocked) throw new Error('Doctrine fallback did not unlock');

        document.querySelector('[data-tool="fortify"]').click();
        const fortifyTargets = [];
        for (let i = 0; i < CF.game.state.tiles.length && fortifyTargets.length < 2; i++) {
          if (CF.engine.canFortify(CF.game.state, 1, i) != null) fortifyTargets.push(i);
        }
        if (fortifyTargets.length < 2) throw new Error('No pair of commands available for wait-phase smoke');
        fortifyTargets.forEach((index) => {
          const rect = CF.render.tileRect(index);
          const map = document.getElementById('map');
          const mapBox = map.getBoundingClientRect();
          map.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            clientX: mapBox.left + (rect.x + rect.s / 2) * mapBox.width / map.clientWidth,
            clientY: mapBox.top + (rect.y + rect.s / 2) * mapBox.height / map.clientHeight
          }));
        });
        CF.game.state.turn = 3;
        document.getElementById('btn-end').click();
        await sleep(30);
        const orderOverlay = CF.game.thinking === 'orders' && document.getElementById('btn-end').disabled;
        for (let attempt = 0; attempt < 60 && CF.game.thinking !== 'director'; attempt++) await sleep(100);
        const directorStats = CF.game.state.stats.length;
        const directorTurn = CF.game.state.turn;
        const directorOverlay = {
          thinking: CF.game.thinking,
          directorClass: document.getElementById('ai-thinking').classList.contains('director'),
          locked: CF.game.interactionLocked,
          detail: document.getElementById('thinking-detail').textContent.trim()
        };
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(60);
        const directorInputFrozen = directorStats === CF.game.state.stats.length && directorTurn === CF.game.state.turn;

        CF.game.newGame(123456);
        await sleep(4300);
        const staleRunDiscarded = CF.game.state.seed === 123456 && CF.game.state.stats.length === 0 &&
          CF.game.state.season === 0 && !CF.game.state.pending;
        return { tutorial, doctrineOverlay, inputFrozen, orderOverlay, directorOverlay, directorInputFrozen, staleRunDiscarded };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (evaluated.exceptionDetails) {
      const detail = evaluated.exceptionDetails.exception && evaluated.exceptionDetails.exception.description;
      throw new Error(detail || evaluated.exceptionDetails.text);
    }
    const value = evaluated.result.value;
    await send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.navigate', { url: appUrl });
    for (let attempt = 0; attempt < 80; attempt++) {
      const ready = await send('Runtime.evaluate', {
        expression: "document.readyState === 'complete' && !!window.CF && !!CF.game && !!CF.render && CF.render.geom.w > 0",
        returnByValue: true
      });
      if (ready.result.value) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const compact = await send('Runtime.evaluate', {
      expression: `(() => {
        const state = CF.game.state;
        const geom = CF.render.geom;
        const index = state.tiles.findIndex((tile) => tile.land);
        const tile = CF.render.tileRect(index);
        const canvas = document.getElementById('map');
        const box = canvas.getBoundingClientRect();
        const clientX = box.left + (tile.x + tile.s / 2) * box.width / canvas.clientWidth;
        const clientY = box.top + (tile.y + tile.s / 2) * box.height / canvas.clientHeight;
        const point = CF.render.pointFromClient(clientX, clientY);
        return {
          tileSize: geom.ts,
          geometry: { w: geom.w, h: geom.h, ox: geom.ox, oy: geom.oy, mapW: geom.ts * state.W, mapH: geom.ts * state.H },
          canvasBox: { width: box.width, height: box.height },
          wholeMapVisible: geom.ox >= 0 && geom.oy >= 0 && geom.ox + geom.ts * state.W <= geom.w && geom.oy + geom.ts * state.H <= geom.h,
          hitTestExact: CF.render.tileAt(point.x, point.y) === index,
          noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth
        };
      })()`,
      returnByValue: true
    });
    value.compactLandscape = compact.result.value;
    const tutorialOk = value.tutorial.slides === 4 && value.tutorial.progress === '4 OF 4' &&
      value.tutorial.dotsAreButtons && value.tutorial.pages.every((page) =>
        page.active === page.page && page.navVisible && page.nextVisible && page.animatedVisual);
    const doctrineOk = value.doctrineOverlay.thinking === 'doctrine' && value.doctrineOverlay.visible &&
      value.doctrineOverlay.ariaBusy === 'true' && value.doctrineOverlay.endDisabled &&
      value.doctrineOverlay.toolDisabled && value.inputFrozen;
    const directorOk = value.orderOverlay && value.directorOverlay.thinking === 'director' &&
      value.directorOverlay.directorClass && value.directorOverlay.locked && value.directorInputFrozen;
    const compactOk = value.compactLandscape.wholeMapVisible && value.compactLandscape.hitTestExact &&
      value.compactLandscape.noHorizontalOverflow && value.compactLandscape.tileSize >= 18;
    console.log(JSON.stringify(value, null, 2));
    if (!tutorialOk || !doctrineOk || !directorOk || !value.staleRunDiscarded || !compactOk)
      throw new Error('Browser tutorial or AI wait assertions failed');
    console.log('PASS browser tutorial, AI wait, input lock, and stale-run checks');
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
