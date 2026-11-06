// Renders the teaser: soundtrack (OfflineAudioContext -> WAV), then 60 fps video with
// 3 subframes per frame blended by ffmpeg tmix for motion blur, then muxes both.
// Usage: node render.cjs [outDir] [workers]
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'out'));
const WORKERS = parseInt(process.argv[3] || '4', 10);
const FPS = 60, SUB = 3, DUR = 15, FRAMES = FPS * DUR;
fs.mkdirSync(OUT, { recursive: true });

function wav(path_, chans, sr) {
  // peak-normalise to -1 dBFS, short fade at the very end, 16-bit PCM
  const n = chans[0].length; let peak = 0;
  for (const c of chans) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i]));
  const g = peak > 0 ? Math.pow(10, -1 / 20) / peak : 1, fade = Math.round(sr * 0.12);
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    for (let c = 0; c < 2; c++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * g * f * 32767))), 44 + i * 4 + c * 2);
  }
  fs.writeFileSync(path_, buf);
}

async function renderAudio(browser) {
  const p = await browser.newPage();
  await p.goto('file://' + path.join(__dirname, 'audio.html'));
  await p.waitForFunction(() => window.ready === true);
  const chans = await p.evaluate(() => window.renderTrack());
  wav(path.join(OUT, 'soundtrack.wav'), chans, 48000);
  await p.close();
  console.log('audio done');
}

async function renderSegment(browser, w, f0, f1) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('page error', e.message));
  await p.goto('file://' + path.join(__dirname, 'scene.html'));
  await p.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
  const seg = path.join(OUT, `seg${w}.mp4`);
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-',
    '-vf', `tmix=frames=${SUB}:weights='1 1 1',select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise(r => ff.on('close', r));
  for (let f = f0; f < f1; f++) {
    for (let s = 0; s < SUB; s++) {
      // subframes spread across the frame's shutter interval, ending on the frame time
      const t = Math.max(0, (f - (SUB - 1 - s) / SUB * 0.5) / FPS);
      await p.evaluate(t => window.seek(t), t);
      const png = await p.screenshot({ type: 'png' });
      if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
    }
    if ((f - f0) % 60 === 0) console.log(`worker ${w}: frame ${f}/${f1}`);
  }
  ff.stdin.end(); await done; await p.close();
  return seg;
}

(async () => {
  const browser = await chromium.launch();
  await renderAudio(browser);
  if (process.argv.includes('--audio-only')) { await browser.close(); return; }
  const per = Math.ceil(FRAMES / WORKERS), jobs = [];
  for (let w = 0; w < WORKERS; w++) jobs.push(renderSegment(browser, w, w * per, Math.min(FRAMES, (w + 1) * per)));
  const segs = await Promise.all(jobs);
  await browser.close();
  const list = path.join(OUT, 'segs.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'));
  const final = path.join(OUT, 'proof-checker-for-mac-teaser.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', path.join(OUT, 'soundtrack.wav'),
    '-map', '0:v', '-map', '1:a', '-af', 'alimiter=limit=0.89:level=false,loudnorm=I=-14:TP=-1:LRA=7', '-ar', '48000', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', final], { stdio: 'inherit' });
  segs.forEach(s => fs.unlinkSync(s)); fs.unlinkSync(list);
  console.log('wrote', final);
})();
