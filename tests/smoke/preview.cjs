const { chromium } = require('./pw.cjs'); // pw.cjs finds Playwright (see that file)
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8199/?seed=3'); await p.waitForTimeout(500);
  const b64 = await p.evaluate(async () => {
    const mod = await import('/src/sound.js');
    // Order like a play session: dig, burrow, hand, rooms, portal, visitors, treasure.
    const seq = [['pick'], ['pick'], ['pick'], ['crumble'], ['pick'], ['pick'], ['crumble'], ['ore'], ['deliver'], ['newMole'], ['found'], ['fanfare'],
      ['markOn'], ['markOff'], ['slap'], ['wall'], ['pave'], ['room'], ['lever'], ['portalOpen'], ['portalBlip'],
      ['squeak', { kind: 'hedgehog' }], ['squeak', { kind: 'frog' }], ['squeak', { kind: 'snail' }], ['squeak', { kind: 'beetle' }],
      ['squeak', { kind: 'bat' }], ['squeak', { kind: 'owl' }], ['squeak', { kind: 'foxcub' }],
      ['greet'], ['group', { kind: 'frog', count: 3 }], ['grow'], ['grow', { final: true }], ['twirl'], ['drip'], ['drip']];
    const rate = 44100, total = 26;
    const ctx = new OfflineAudioContext(1, rate * total, rate);
    const noise = ctx.createBuffer(1, rate, rate); const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // Reach the generators through renderOffline by temporarily offsetting time: render each into a gain at its slot.
    let t = 0.3;
    const SOUNDS = mod.__debugSounds;
    for (const [name, opts] of seq) {
      const len = SOUNDS[name](ctx, ctx.destination, t, noise, opts || {});
      t += len + (['crumble', 'fanfare', 'portalOpen', 'grow', 'group'].includes(name) ? 0.55 : 0.35);
    }
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    const n = Math.min(d.length, Math.ceil((t + 0.5) * rate));
    // Write a 16-bit WAV file by hand: a 44-byte header, then the samples.
    const out = new DataView(new ArrayBuffer(44 + n * 2));
    const s = (o, str) => [...str].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    s(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
    out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); s(36, 'data'); out.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i] * 1.6)) * 32767, true);
    let bin = ''; const bytes = new Uint8Array(out.buffer); for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
  fs.writeFileSync(process.argv[2], Buffer.from(b64, 'base64'));
  await b.close();
})();
