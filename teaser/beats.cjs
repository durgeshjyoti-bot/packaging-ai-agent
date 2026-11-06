// Renders one frame per beat (at beat + offset) for review, plus any extra times passed as args.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2]; const off = parseFloat(process.argv[3] || '0.35');
  const extra = process.argv.slice(4).map(Number);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('console', m => console.log('page:', m.text())); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + path.resolve(__dirname, 'scene.html'));
  await p.waitForFunction(() => window.ready === true, null, { timeout: 20000 });
  const times = extra.length ? extra : Array.from({ length: 30 }, (_, i) => i * 0.5 + off);
  for (const t of times) {
    await p.evaluate(t => window.seek(t), t);
    await p.screenshot({ path: `${out}/t${t.toFixed(3).padStart(6, '0')}.png` });
  }
  await b.close();
})();
