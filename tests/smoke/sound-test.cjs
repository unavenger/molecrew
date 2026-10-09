// Renders every generated sound offline and checks it makes audible, finite output.
const { chromium } = require('./pw.cjs'); // pw.cjs finds Playwright (see that file)
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8199/?seed=3'); await p.waitForTimeout(800);
  const res = await p.evaluate(async () => {
    const mod = await import('/src/sound.js');
    const out = [];
    const optsFor = { squeak: [{ kind: 'frog' }, { kind: 'owl' }, { kind: 'bat' }, { kind: 'hedgehog' }, { kind: 'beetle' }, { kind: 'foxcub' }, { kind: 'snail', stage: 0 }],
      group: [{ kind: 'frog', count: 3 }], grow: [{ final: true }, { final: false }], portalBlip: [{}, { down: true }] };
    for (const name of mod.SOUND_NAMES) {
      for (const opts of optsFor[name] || [{}]) {
        const ctx = new OfflineAudioContext(1, 44100 * 2, 44100); // renders audio into memory, faster than real time
        const len = mod.renderOffline(ctx, name, opts);
        const buf = await ctx.startRendering();
        const d = buf.getChannelData(0);
        let sum = 0, peak = 0, bad = false;
        for (const v of d) { if (!Number.isFinite(v)) bad = true; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
        out.push({ name: name + (opts.kind ? ':' + opts.kind : '') + (opts.final ? ':final' : ''), len: +len.toFixed(2), rms: +Math.sqrt(sum / d.length).toFixed(4), peak: +peak.toFixed(2), bad });
      }
    }
    return out;
  });
  // Live game: click to unlock audio, then run a cave with everything happening.
  await p.mouse.click(300, 300);
  const live = await p.evaluate(async () => {
    const g = window.moleCrew(); const w = g.world, s = g.sim;
    for (let i = 0; i < w.W * w.H; i++) w.setMark(i, true);
    for (let k = 0; k < 30; k++) { for (let j = 0; j < 600; j++) s.update(1/30); await new Promise(r => requestAnimationFrame(r)); }
    return { state: document.querySelector('#mute').hidden };
  });
  await p.keyboard.press('m'); await p.keyboard.press('m');
  console.log(JSON.stringify(res));
  const silent = res.filter(r => r.rms < 0.002 || r.bad || r.peak > 1.5);
  console.log('silent/bad:', JSON.stringify(silent));
  console.log('live:', JSON.stringify(live), errs.length ? 'ERRORS ' + errs.join(' | ') : 'NO PAGE ERRORS');
  await b.close();
})();
