const { chromium } = require('./pw.cjs'); // pw.cjs finds Playwright (see that file)
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto('http://localhost:8199/?seed=51'); await p.waitForTimeout(800);
  await p.mouse.click(300, 300);
  // Dig a one-tile tunnel to the portal (no rooms) so the narrator has needs to nudge about.
  const r = await p.evaluate(async () => {
    const g = window.moleCrew(); const w = g.world, s = g.sim;
    let { x, y } = w.burrow; const P = w.portal;
    while (x !== P.x) { x += Math.sign(P.x - x); w.setMark(w.idx(x, y), true); }
    while (y !== P.y) { y += Math.sign(P.y - y); w.setMark(w.idx(x, y), true); }
    const captions = new Set();
    for (let k = 0; k < 120; k++) {
      for (let j = 0; j < 60; j++) s.update(1/30);
      await new Promise(r => requestAnimationFrame(r));
      const c = document.getElementById('caption');
      if (c.classList.contains('on')) captions.add(c.textContent);
    }
    return { captions: [...captions], speech: 'speechSynthesis' in window };
  });
  await p.keyboard.press('c'); await p.keyboard.press('c');
  console.log(JSON.stringify(r, null, 1)); console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO PAGE ERRORS');
  await b.close();
})();
