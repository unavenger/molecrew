const { chromium } = require('./pw.cjs'); // pw.cjs finds Playwright (see that file)
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + (e.stack||'').split('\n').slice(0,4).join('\n')));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('http://localhost:8199/?seed=7'); await p.waitForTimeout(1500);
  // Exercise input: hover, box-drag, click.
  await p.mouse.move(400, 300); await p.mouse.down(); await p.mouse.move(600, 420, { steps: 8 }); await p.mouse.up();
  await p.mouse.click(500, 350); await p.mouse.click(500, 350, { button: 'right' });
  await p.keyboard.down('d'); await p.waitForTimeout(300); await p.keyboard.up('d');
  console.log('early:', errs.join('\n') || 'none');
  // Fast-forward the cave: mark everything, run 12 simulated minutes, render frames between.
  const info = await p.evaluate(async () => {
    const g = window.moleCrew(); const w = g.world, s = g.sim;
    for (let i = 0; i < w.W * w.H; i++) w.setMark(i, true);
    for (let k = 0; k < 40; k++) { for (let j = 0; j < 900; j++) s.update(1/30); await new Promise(r => requestAnimationFrame(r)); }
    if (s.rooms.length) { s.pullLever(0); s.pullLever(1); }
    if (s.visitors.length) s.slapVisitor(s.visitors[0].id);
    s.slap(0); s.slapTreasure(0); s.slapTreasure(5);
    for (let k = 0; k < 30; k++) await new Promise(r => requestAnimationFrame(r));
    return { stages: s.visitors.map(v=>v.stage).join(""), treasures: s.trove.filter(Boolean).length, rooms: s.rooms.length, visitors: s.visitors.length, portal: s.portal.awake, marks: w.markedSet.size };
  });
  await p.mouse.move(420, 320); await p.mouse.click(420, 320); await p.keyboard.press('n'); await p.waitForTimeout(500);
  console.log(JSON.stringify(info)); console.log(errs.length ? errs.join('\n') : 'NO ERRORS');
  await b.close();
})();
