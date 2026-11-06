// Creates a fully drawn sample house for the landing-page showroom screenshots:
// client, project, two floors with the sample PDF, scale, circuits, components and wires.
// Usage (API running locally):  node scripts/seed-showroom.mjs <email> <password> [apiBase]
// The account should be a local test account (see apps/api/.env.example).
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { calibratePaperScale, componentType } from '../packages/shared/dist/index.js';

const [email, password, base = 'http://localhost:3000'] = process.argv.slice(2);
if (!email || !password) throw new Error('Usage: node scripts/seed-showroom.mjs <email> <password> [apiBase]');

let cookie = '';
async function api(method, path, body, raw = false) {
  const headers = { cookie, origin: 'http://localhost:4200' };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + '/api' + path, { method, headers, body: payload });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return raw ? res : res.status === 204 ? null : res.json();
}

// Plan coordinates of the sample house (scripts/make-sample-plans.mjs): 1:50 on A3, house corner at (150, 135).
const M = (72 / 25.4) * (1000 / 50);
const P = (x, y) => ({ x: 150 + x * M, y: 135 + y * M });

await api('POST', '/auth/sign-in', { email, password });

const client = await api('POST', '/clients', { name: 'Familja Berisha', phone: '+383 44 123 456', email: null, address: 'Rruga e Trëndafilave 12, Prishtinë', notes: null });
const project = await api('POST', '/projects', { clientId: client.id, name: 'Shtëpia Berisha – instalimi elektrik', propertyAddress: 'Rruga e Trëndafilave 12, Prishtinë', status: 'IN_PROGRESS', description: null });
const pdf = readFileSync(new URL('../docs/samples/sample-house-plans.pdf', import.meta.url));

async function makeFloor(name, page) {
  const floor = await api('POST', `/projects/${project.id}/floors`, { name });
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'shtepia-berisha.pdf');
  let f = await api('PUT', `/floors/${floor.id}/plan`, form);
  f = await api('PATCH', `/floors/${floor.id}/settings`, { baseRevision: f.revision, planPage: page, calibration: calibratePaperScale(50), calibrationNeedsCheck: false });
  return f;
}
const ground = await makeFloor('Përdhesa', 1);
const first = await makeFloor('Kati i parë', 2);

// ── Components ───────────────────────────────────────────────────────────
const comps = [];
function add(typeKey, x, y, label, rotation = 0) {
  const t = componentType(typeKey);
  if (!t) throw new Error('Unknown type ' + typeKey);
  const c = {
    id: randomUUID(), typeKey, typeVersion: t.version, layerKey: t.defaultLayer, label, ...P(x, y), rotation,
    mountHeightMm: t.defaultMountHeight ?? null, description: null, properties: { ...(t.defaults ?? {}) }, circuitId: null,
  };
  comps.push(c);
  return c;
}
const board = add('board.main', 6.55, 8.35, 'PK');
// lighting
const L = {
  living1: add('light.ceiling', 1.6, 1.4, 'L1'), living2: add('light.ceiling', 4.6, 1.4, 'L2'),
  dining: add('light.dimmable', 3.8, 6.2, 'L3'), kitchen1: add('light.spot', 7.4, 1.2, 'L4'),
  kitchen2: add('light.spot', 10.4, 1.2, 'L5'), kitchenStrip: add('light.led-strip', 9.0, 3.9, 'L6'),
  hall: add('light.ceiling', 8.0, 4.95, 'L7'), wc: add('light.wall', 10.9, 5.0, 'L8'), office: add('light.ceiling', 10.6, 7.25, 'L9'),
  outdoor: add('light.outdoor', 8.0, 9.15, 'L10'),
};
const S = {
  living: add('switch.double', 5.7, 3.2, 'S1'), dining: add('switch.dimmer', 5.7, 6.85, 'S2'),
  kitchen: add('switch.double', 8.15, 4.25, 'S3'), hall: add('switch.two-way', 7.95, 8.4, 'S4'),
  wc: add('switch.single', 8.75, 6.0, 'S5'), office: add('switch.single', 8.75, 8.3, 'S6'),
};
const O = {
  living1: add('outlet.double', 0.55, 4.3, 'P1'), living2: add('outlet.double', 3.0, 0.55, 'P2'), living3: add('outlet.usb', 5.7, 1.1, 'P3'),
  dining1: add('outlet.double', 0.55, 6.4, 'P4'), dining2: add('outlet.single', 3.0, 8.45, 'P5'),
  kitchen1: add('outlet.double', 6.6, 0.55, 'P6'), kitchen2: add('outlet.double', 9.2, 0.55, 'P7'), oven: add('outlet.appliance', 11.45, 2.0, 'P8'),
  fridge: add('outlet.single', 11.45, 3.6, 'P9'), office1: add('outlet.double', 11.45, 8.1, 'P10'), wc: add('outlet.waterproof', 11.45, 5.9, 'P11'),
};
const tv = add('comm.tv', 0.55, 2.6, 'TV1');
const rj = add('comm.rj45', 11.45, 7.4, 'D1');
const wifi = add('comm.wifi-ap', 7.0, 4.8, 'AP1');

// ── Circuits ─────────────────────────────────────────────────────────────
const circuit = (number, name, category, phase, breaker, cross) =>
  api('POST', `/projects/${project.id}/circuits`, {
    number, name, category, boardComponentId: board.id, phase, voltage: 230, protection: 'MCB', breakerRatingA: breaker, breakerCurve: 'B',
    rcdGroup: category === 'Lighting' ? null : 'RCD1', residualCurrentMa: category === 'Lighting' ? null : 30, cableType: 'NYM-J', crossSectionMm2: cross,
    manualLoadW: null, description: null,
  });
// The board must exist on the drawing before circuits can reference it.
let rev = (await api('GET', `/floors/${ground.id}/drawing`)).revision;
rev = (await api('PATCH', `/floors/${ground.id}/drawing`, { baseRevision: rev, ops: [{ op: 'upsert', component: board }] })).revision;
const cLight = await circuit('1', 'Ndriçimi – përdhesa', 'Lighting', 'L1', 10, 1.5);
const cLiving = await circuit('2', 'Prizat – dhoma e ndenjes', 'Sockets', 'L2', 16, 2.5);
const cKitchen = await circuit('3', 'Prizat – kuzhina', 'Kitchen', 'L3', 16, 2.5);
const cOven = await circuit('4', 'Furra', 'Kitchen', 'L1', 16, 2.5);
const cRest = await circuit('5', 'Prizat – zyra dhe banja', 'Sockets', 'L2', 16, 2.5);

const setC = (c, cid) => { c.circuitId = cid; };
Object.values(L).forEach((c) => setC(c, cLight.id));
Object.values(S).forEach((c) => setC(c, cLight.id));
[O.living1, O.living2, O.living3, O.dining1, O.dining2].forEach((c) => setC(c, cLiving.id));
[O.kitchen1, O.kitchen2, O.fridge].forEach((c) => setC(c, cKitchen.id));
setC(O.oven, cOven.id);
[O.office1, O.wc].forEach((c) => setC(c, cRest.id));

// ── Wires (orthogonal routes through bend points, in metres) ─────────────
const wires = [];
const COLORS = { light: '#c2410c', sockets: '#1d4ed8', kitchen: '#15803d', oven: '#b91c1c', rest: '#7e22ce' };
function wire(a, b, bends, cid, color, cores = 3, cross = 1.5) {
  const end = (c) => ({ componentId: c.id, portId: null, x: c.x, y: c.y });
  wires.push({
    id: randomUUID(), label: null, from: end(a), to: end(b), points: bends.map(([x, y]) => P(x, y)),
    cable: { cableType: 'NYM-J', conductors: cores, crossSectionMm2: cross, voltage: 230, installMethod: 'In conduit in wall', color, lineStyle: 'solid' },
    circuitId: cid, description: null,
  });
}
// lighting circuit
wire(board, L.hall, [[6.55, 7.9], [8.0, 7.9]], cLight.id, COLORS.light);
wire(L.hall, S.kitchen, [], cLight.id, COLORS.light);
wire(S.kitchen, L.kitchen1, [[7.4, 4.25]], cLight.id, COLORS.light);
wire(L.kitchen1, L.kitchen2, [], cLight.id, COLORS.light);
wire(L.kitchen2, L.kitchenStrip, [[10.4, 3.9]], cLight.id, COLORS.light);
wire(L.hall, S.living, [[5.7, 4.95]], cLight.id, COLORS.light);
wire(S.living, L.living2, [[4.6, 3.2]], cLight.id, COLORS.light);
wire(L.living2, L.living1, [], cLight.id, COLORS.light);
wire(S.living, S.dining, [], cLight.id, COLORS.light);
wire(S.dining, L.dining, [[3.8, 6.85]], cLight.id, COLORS.light);
wire(L.hall, S.wc, [[8.75, 4.95]], cLight.id, COLORS.light);
wire(S.wc, L.wc, [[10.9, 6.0]], cLight.id, COLORS.light);
wire(S.wc, S.office, [], cLight.id, COLORS.light);
wire(S.office, L.office, [[10.6, 8.3]], cLight.id, COLORS.light);
wire(board, S.hall, [[7.95, 8.35]], cLight.id, COLORS.light);
wire(S.hall, L.outdoor, [[8.0, 8.4]], cLight.id, COLORS.light);
// living sockets
wire(board, O.dining2, [[6.2, 8.35], [6.2, 8.45]], cLiving.id, COLORS.sockets, 3, 2.5);
wire(O.dining2, O.dining1, [[0.55, 8.45]], cLiving.id, COLORS.sockets, 3, 2.5);
wire(O.dining1, O.living1, [], cLiving.id, COLORS.sockets, 3, 2.5);
wire(O.living1, O.living2, [[0.55, 0.55]], cLiving.id, COLORS.sockets, 3, 2.5);
wire(O.living2, O.living3, [[5.7, 0.55]], cLiving.id, COLORS.sockets, 3, 2.5);
// kitchen
wire(board, O.kitchen1, [[6.35, 8.35], [6.35, 0.55]], cKitchen.id, COLORS.kitchen, 3, 2.5);
wire(O.kitchen1, O.kitchen2, [], cKitchen.id, COLORS.kitchen, 3, 2.5);
wire(O.kitchen2, O.fridge, [[11.45, 0.55]], cKitchen.id, COLORS.kitchen, 3, 2.5);
wire(board, O.oven, [[6.45, 8.35], [6.45, 4.4], [11.3, 4.4], [11.3, 2.0]], cOven.id, COLORS.oven, 3, 2.5);
// office + bathroom
wire(board, O.office1, [[6.75, 8.6], [11.45, 8.6]], cRest.id, COLORS.rest, 3, 2.5);
wire(O.office1, O.wc, [], cRest.id, COLORS.rest, 3, 2.5);

const ops = [
  ...comps.filter((c) => c !== board).map((component) => ({ op: 'upsert', component })),
  { op: 'upsert', component: board },
  ...wires.map((wire) => ({ op: 'upsertWire', wire })),
];
await api('PATCH', `/floors/${ground.id}/drawing`, { baseRevision: rev, ops });

// first floor: a sub-board fed from the main board
const sub = { ...add('board.sub', 6.55, 8.35, 'NP1') };
let rev2 = (await api('GET', `/floors/${first.id}/drawing`)).revision;
await api('PATCH', `/floors/${first.id}/drawing`, { baseRevision: rev2, ops: [{ op: 'upsert', component: sub }] });
await api('POST', `/projects/${project.id}/links`, {
  fromComponentId: board.id, toComponentId: sub.id, lengthM: 6.5,
  cable: { cableType: 'NYM-J', conductors: 5, crossSectionMm2: 6, voltage: 400, installMethod: 'In conduit in wall', color: '#111827', lineStyle: 'solid' },
  circuitId: null, description: 'Vertikalja në shahtin e shkallëve',
});

console.log(JSON.stringify({ projectId: project.id, groundFloorId: ground.id, firstFloorId: first.id, components: comps.length, wires: wires.length }));
