const { chromium } = require('./pw.cjs'); // pw.cjs finds Playwright (see that file)
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message + ' ' + (e.stack||'').split('\n')[1]));
  await p.goto('http://localhost:8199/?seed=7'); await p.waitForTimeout(800);
  await p.mouse.click(300, 300);
  const r = await p.evaluate(async () => {
    const g = window.moleCrew(); const w = g.world, s = g.sim;
    for (let i = 0; i < w.W * w.H; i++) w.setMark(i, true);
    for (let k = 0; k < 30; k++) { for (let j = 0; j < 900; j++) s.update(1/30); await new Promise(r => requestAnimationFrame(r)); }
    const out = { rooms: s.rooms.length };
    g.renderer.openFan(0);
    for (let k = 0; k < 10; k++) await new Promise(r => requestAnimationFrame(r));
    out.fanOpen = !!g.renderer.fan && g.renderer.fan.buttons.length;
    g.renderer.setFanHover(2);
    const before = s.rooms[0].type;
    s.setRoomType(0, (before + 3) % 6);
    g.renderer.closeFan();
    for (let k = 0; k < 10; k++) await new Promise(r => requestAnimationFrame(r));
    out.typeChanged = s.rooms[0].type !== before;
    out.signs = [...g.renderer.leverViews.values()].filter(v => v.sign).length;
    return out;
  });
  await p.mouse.click(400, 300); await p.keyboard.press('Escape');
  console.log(JSON.stringify(r)); console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO PAGE ERRORS');
  await b.close();
})();
