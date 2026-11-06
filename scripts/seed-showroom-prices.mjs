// Adds sample materials and material rules for the symbols the showroom house uses, so its
// material list and cost summary are complete. Prices are fictional. Safe to run twice.
// Usage: node scripts/seed-showroom-prices.mjs <email> <password> [apiBase]
const [email, password, base = 'http://localhost:3000'] = process.argv.slice(2);
let cookie = '';
async function api(method, path, body) {
  const headers = { cookie, origin: 'http://localhost:4200', 'content-type': 'application/json' };
  const res = await fetch(base + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
await api('POST', '/auth/sign-in', { email, password });

// code, name, unit, price, category, rule targets [typeKey, quantity, labour minutes]
const SAMPLE = [
  ['SH-NDR-01', 'Ndriçues tavani LED 18 W (shembull)', 'pcs', 24, 'Ndriçim', [['light.ceiling', 1, 20]]],
  ['SH-NDR-02', 'Ndriçues muri LED (shembull)', 'pcs', 19, 'Ndriçim', [['light.wall', 1, 20]]],
  ['SH-NDR-03', 'Spot LED GU10 me rrethore (shembull)', 'pcs', 7.5, 'Ndriçim', [['light.spot', 1, 15]]],
  ['SH-NDR-04', 'Shirit LED 5 m me ushqyes (shembull)', 'set', 32, 'Ndriçim', [['light.led-strip', 1, 30]]],
  ['SH-NDR-05', 'Ndriçues i jashtëm IP65 (shembull)', 'pcs', 29, 'Ndriçim', [['light.outdoor', 1, 25]]],
  ['SH-NDR-06', 'Ndriçues me dimer, varëse (shembull)', 'pcs', 45, 'Ndriçim', [['light.dimmable', 1, 25]]],
  ['SH-PRZ-01', 'Prizë Schuko e thjeshtë (shembull)', 'pcs', 4.2, 'Priza', [['outlet.single', 1, 15], ['outlet.appliance', 1, 20]]],
  ['SH-PRZ-02', 'Prizë USB A+C (shembull)', 'pcs', 18, 'Priza', [['outlet.usb', 1, 15]]],
  ['SH-PRZ-03', 'Prizë IP44 me kapak (shembull)', 'pcs', 9.5, 'Priza', [['outlet.waterproof', 1, 20]]],
  ['SH-CEL-02', 'Çelës i dyfishtë (shembull)', 'pcs', 7, 'Çelësa', [['switch.double', 1, 15]]],
  ['SH-CEL-03', 'Çelës alternativ (shembull)', 'pcs', 6, 'Çelësa', [['switch.two-way', 1, 15]]],
  ['SH-CEL-04', 'Dimer LED (shembull)', 'pcs', 22, 'Çelësa', [['switch.dimmer', 1, 20]]],
  ['SH-PNL-01', 'Panel shpërndarës 36 module me pajisje (shembull)', 'set', 240, 'Shpërndarje', [['board.main', 1, 240]]],
  ['SH-PNL-02', 'Nënpanel 12 module me pajisje (shembull)', 'set', 95, 'Shpërndarje', [['board.sub', 1, 120]]],
  ['SH-TV-01', 'Prizë TV koaksiale (shembull)', 'pcs', 6.5, 'Komunikim', [['comm.tv', 1, 15]]],
  ['SH-WIFI-01', 'Pikë qasjeje Wi-Fi tavani (shembull)', 'pcs', 89, 'Komunikim', [['comm.wifi-ap', 1, 30]]],
];
const materials = await api('GET', '/materials');
const rules = await api('GET', '/material-rules');
const box = materials.find((m) => m.code === 'EX-BOX-60');
const frame = materials.find((m) => m.code === 'EX-FR-1');
const rj45 = materials.find((m) => m.code === 'W-RJ45');
let addedM = 0, addedR = 0;
async function rule(target, materialId, quantity, labourMinutes) {
  if (rules.some((r) => r.target === target && r.materialId === materialId)) return;
  await api('POST', '/material-rules', { target, materialId, quantity, labourMinutes });
  addedR++;
}
for (const [code, name, unit, unitPrice, category, targets] of SAMPLE) {
  let m = materials.find((x) => x.code === code);
  if (!m) { m = await api('POST', '/materials', { code, name, unit, unitPrice, packSize: null, category, archived: false }); addedM++; }
  for (const [typeKey, q, min] of targets) {
    await rule(`component:${typeKey}`, m.id, q, min);
    // wall devices also need a flush box and a frame
    if (box && /^(outlet|switch|comm\.(tv|rj45))/.test(typeKey)) await rule(`component:${typeKey}`, box.id, 1, 0);
    if (frame && /^(outlet|switch)/.test(typeKey)) await rule(`component:${typeKey}`, frame.id, 1, 0);
  }
}
if (rj45) await rule('component:comm.rj45', rj45.id, 1, 20);
const sw = materials.find((m) => m.code === 'EX-SW-1');
if (sw) {
  await rule('component:switch.single', sw.id, 1, 15);
  if (box) await rule('component:switch.single', box.id, 1, 0);
  if (frame) await rule('component:switch.single', frame.id, 1, 0);
}
console.log(`materials added: ${addedM}, rules added: ${addedR}`);
