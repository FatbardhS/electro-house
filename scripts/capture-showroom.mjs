// Captures the landing-page showroom screenshots (Albanian and English) with headless Chrome.
// Needs the local web (4200) and API (3000) running and a project made by seed-showroom.mjs.
// Usage: node scripts/capture-showroom.mjs <email> <password> <projectId> <floorId>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [email, password, projectId, floorId] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WEB = 'http://localhost:4200';
const OUT = new URL('../apps/web/public/showroom/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const PORT = 9334;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'eh-shots-'))}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) {
  try { targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page'); } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${WEB}/sign-in` });
await sleep(2500);
console.log('sign-in', await run(`fetch('/api/auth/sign-in',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify({ email, password })})}).then(r=>r.status)`));

/** Waits until no loading spinner is shown (max 20 s), then a moment for animations. */
async function settle(min) {
  await sleep(min);
  for (let i = 0; i < 40; i++) {
    if (await run("!document.querySelector('app-loading') && document.readyState === 'complete'")) break;
    await sleep(500);
  }
  await sleep(800);
}
const clickText = (text) => run(`(() => { const b = [...document.querySelectorAll('button, a')].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)})); if (b) b.click(); return !!b; })()`);

const shots = [
  { file: 'editor', url: `/projects/${projectId}/floors/${floorId}`, wait: 5000, after: async () => { await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))`); await sleep(1500); } },
  { file: 'circuits', url: `/projects/${projectId}/installation?tab=circuits`, wait: 3000 },
  { file: 'materials', url: `/projects/${projectId}/installation?tab=materials`, wait: 3500 },
  { file: 'checks', url: `/projects/${projectId}/installation?tab=checks`, wait: 3000 },
  { file: 'export', url: `/projects/${projectId}/installation?tab=boards`, wait: 3000, after: async (lang) => { await clickText(lang === 'sq' ? 'Eksporto PDF' : 'Export PDF'); await sleep(1200); } },
];

for (const lang of ['sq', 'en']) {
  console.log('language', lang, await run(`fetch('/api/auth/language',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({language:'${lang}'})}).then(r=>r.status)`));
  await run(`localStorage.setItem('eh.lang','${lang}')`);
  for (const s of shots) {
    await send('Page.navigate', { url: WEB + s.url });
    await settle(s.wait);
    if (s.after) await s.after(lang);
    const shot = await send('Page.captureScreenshot', { format: 'webp', quality: 82 });
    writeFileSync(new URL(`${s.file}-${lang}.webp`, OUT), Buffer.from(shot.result.data, 'base64'));
    console.log('saved', `${s.file}-${lang}.webp`);
  }
}
// leave the account in Albanian
await run(`fetch('/api/auth/language',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({language:'sq'})})`);
ws.close();
chrome.kill();
process.exit(0);
