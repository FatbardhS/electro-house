import { z } from 'zod';
import type { Category, ComponentType, LayerKey, PropertyField, SymbolPrimitive } from './types.js';

/*
 * Electrical component catalog. Symbols follow IEC 60617 installation-plan conventions
 * (lamp = circle with cross, socket outlet = semicircle, switch = small circle with a stroke and ticks),
 * with short letter codes where the standard uses a qualifying letter or text (TV, TP, kWh, RCD …).
 * All geometry is in paper millimetres around the insertion point (0,0), y pointing down.
 */

// ── primitive helpers ───────────────────────────────────────────────────
const P = (d: string, fill: 'none' | 'stroke' | 'paper' = 'none'): SymbolPrimitive => ({ kind: 'path', d, fill });
const C = (r: number, cx = 0, cy = 0, fill: 'none' | 'stroke' | 'paper' = 'paper'): SymbolPrimitive => ({
  kind: 'circle',
  cx,
  cy,
  r,
  fill,
});
const T = (text: string, x = 0, y = 0, size = 2): SymbolPrimitive => ({ kind: 'text', x, y, text, size });
const L = (x1: number, y1: number, x2: number, y2: number) => P(`M ${x1} ${y1} L ${x2} ${y2}`);
const box = (w: number, h: number, fill: 'none' | 'paper' = 'paper') =>
  P(`M ${-w / 2} ${-h / 2} H ${w / 2} V ${h / 2} H ${-w / 2} Z`, fill);
/** Small qualifying text at the top-right of a symbol. */
const badge = (text: string) => T(text, 3.9, -3.2, 2);

// Lamp: circle with diagonal cross.
const R_LAMP = 2.5;
const lamp = (r = R_LAMP): SymbolPrimitive[] => {
  const d = +(r * Math.SQRT1_2).toFixed(3);
  return [C(r), L(-d, -d, d, d), L(-d, d, d, -d)];
};

// Socket outlet: semicircle on a diameter with a stem towards the wall (+y), earth line on top.
const socket = (filled = false): SymbolPrimitive[] => [
  P('M -2.5 0 A 2.5 2.5 0 0 1 2.5 0 Z', filled ? 'stroke' : 'paper'),
  L(0, 0, 0, 2.5),
];
const earthBar = L(-2.5, -3.1, 2.5, -3.1);

// Switch: small circle, stroke at 45° up-right, ticks perpendicular at the end.
const SW_END = { x: 3.2, y: -3.2 };
const switchBase = (ticks: number): SymbolPrimitive[] => {
  const prims: SymbolPrimitive[] = [L(0.7, -0.7, SW_END.x, SW_END.y)];
  for (let i = 0; i < ticks; i++) {
    const t = 1 - i * 0.28; // positions along the stroke from the end
    const x = 0.7 + (SW_END.x - 0.7) * t;
    const y = -0.7 + (SW_END.y + 0.7) * t;
    prims.push(L(x, y, x + 1.1, y + 1.1));
  }
  prims.push(C(1));
  return prims;
};

// ── property fields ─────────────────────────────────────────────────────
const IP = ['IP20', 'IP44', 'IP54', 'IP55', 'IP65', 'IP66', 'IP67'] as const;
const powerW: PropertyField = { key: 'powerW', label: 'Power', kind: 'number', unit: 'W', min: 0, max: 100000 };
const ipRating: PropertyField = { key: 'ipRating', label: 'IP rating', kind: 'select', options: IP };
const lampType: PropertyField = {
  key: 'lampType',
  label: 'Lamp type',
  kind: 'select',
  options: ['LED', 'Halogen', 'Fluorescent', 'Incandescent', 'Other'],
};
const loadW: PropertyField = { key: 'loadW', label: 'Expected load', kind: 'number', unit: 'W', min: 0, max: 100000 };
const ratedA: PropertyField = { key: 'ratedCurrentA', label: 'Rated current', kind: 'number', unit: 'A', min: 0, max: 4000 };
const poles: PropertyField = { key: 'poles', label: 'Poles', kind: 'select', options: ['1P', '1P+N', '2P', '3P', '3P+N', '4P'] };
const curve: PropertyField = { key: 'curve', label: 'Tripping curve', kind: 'select', options: ['B', 'C', 'D', 'K', 'Z'] };
const residual: PropertyField = {
  key: 'residualCurrentMa',
  label: 'Residual current',
  kind: 'select',
  options: ['10 mA', '30 mA', '100 mA', '300 mA', '500 mA'],
};
const rcdType: PropertyField = { key: 'rcdType', label: 'RCD type', kind: 'select', options: ['AC', 'A', 'F', 'B'] };
const ways: PropertyField = { key: 'ways', label: 'Modules / ways', kind: 'number', min: 1, max: 288, integer: true };
const earthed: PropertyField = { key: 'earthed', label: 'Earthed (PE)', kind: 'boolean' };
const notes: PropertyField = { key: 'model', label: 'Manufacturer / model', kind: 'text', maxLength: 120 };

// ── catalog builder ─────────────────────────────────────────────────────
interface Def {
  key: string;
  name: string;
  prefix: string;
  primitives: SymbolPrimitive[];
  hit?: number;
  fields?: PropertyField[];
  defaults?: Record<string, unknown>;
  mount?: number;
  layer?: LayerKey;
  keywords?: string[];
}

const LAYER_FOR: Record<Category, LayerKey> = {
  lighting: 'lighting',
  outlets: 'outlets',
  switches: 'switches',
  distribution: 'distribution',
  communication: 'data',
  smart: 'smart',
  renewable: 'distribution',
  annotation: 'annotations',
};

function group(category: Category, defs: Def[]): ComponentType[] {
  return defs.map((d) => ({
    key: d.key,
    version: 1,
    category,
    name: d.name,
    defaultLayer: d.layer ?? LAYER_FOR[category],
    labelPrefix: d.prefix,
    symbol: { primitives: d.primitives, hitRadiusMm: d.hit ?? 3.2 },
    ports: [{ id: 'p', offsetMm: { x: 0, y: 0 } }],
    fields: [...(d.fields ?? []), notes],
    defaults: d.defaults ?? {},
    defaultMountHeightMm: d.mount,
    keywords: d.keywords,
  }));
}

const lightFields = [powerW, lampType, ipRating];
const lightDefaults = { powerW: 10, lampType: 'LED', ipRating: 'IP20' };

export const COMPONENT_TYPES: readonly ComponentType[] = [
  ...group('lighting', [
    { key: 'light.ceiling', name: 'Ceiling light', prefix: 'L', primitives: lamp(), fields: lightFields, defaults: lightDefaults, keywords: ['lamp', 'luminaire'] },
    { key: 'light.wall', name: 'Wall light', prefix: 'L', primitives: [...lamp(), L(-2.5, 3.4, 2.5, 3.4)], fields: lightFields, defaults: lightDefaults, mount: 2000, keywords: ['sconce'] },
    { key: 'light.led-strip', name: 'LED strip', prefix: 'LS', primitives: [box(12, 2.4), T('LED', 0, 0, 1.6)], hit: 4, fields: [...lightFields, { key: 'lengthM', label: 'Length', kind: 'number', unit: 'm', min: 0, max: 500 }], defaults: { ...lightDefaults, powerW: 10, lengthM: 1 } },
    { key: 'light.spot', name: 'LED spotlight', prefix: 'L', primitives: [...lamp(1.6), C(0.45, 0, 0, 'stroke')], hit: 2.4, fields: lightFields, defaults: { ...lightDefaults, powerW: 6 }, keywords: ['downlight'] },
    { key: 'light.outdoor', name: 'Outdoor light', prefix: 'L', primitives: [box(6.6, 6.6, 'none'), ...lamp()], hit: 3.6, fields: lightFields, defaults: { ...lightDefaults, ipRating: 'IP65' }, keywords: ['exterior', 'garden'] },
    { key: 'light.emergency', name: 'Emergency light', prefix: 'EL', primitives: [...lamp(), C(0.9, 0, 0, 'stroke'), badge('E')], fields: [...lightFields, { key: 'autonomyH', label: 'Autonomy', kind: 'number', unit: 'h', min: 0, max: 24 }], defaults: { ...lightDefaults, powerW: 3, autonomyH: 1 }, keywords: ['exit'] },
    { key: 'light.dimmable', name: 'Dimmable light', prefix: 'L', primitives: [...lamp(), badge('D')], fields: lightFields, defaults: lightDefaults },
    { key: 'light.smart', name: 'Smart light', prefix: 'L', primitives: [...lamp(), badge('S')], fields: lightFields, defaults: lightDefaults, keywords: ['zigbee', 'wifi'] },
  ]),
  ...group('outlets', [
    { key: 'outlet.single', name: 'Single outlet', prefix: 'P', primitives: [...socket(), earthBar], fields: [loadW, ipRating, earthed], defaults: { loadW: 200, ipRating: 'IP20', earthed: true }, mount: 300, keywords: ['socket', 'schuko'] },
    { key: 'outlet.double', name: 'Double outlet', prefix: 'P', primitives: [...socket(), earthBar, badge('2')], fields: [loadW, ipRating, earthed], defaults: { loadW: 400, ipRating: 'IP20', earthed: true }, mount: 300, keywords: ['socket'] },
    { key: 'outlet.triple', name: 'Triple outlet', prefix: 'P', primitives: [...socket(), earthBar, badge('3')], fields: [loadW, ipRating, earthed], defaults: { loadW: 600, ipRating: 'IP20', earthed: true }, mount: 300, keywords: ['socket'] },
    { key: 'outlet.industrial', name: 'Industrial outlet (CEE)', prefix: 'P', primitives: [...socket(), earthBar, box(6.8, 7.4, 'none')], hit: 3.8, fields: [loadW, ratedA, poles, ipRating], defaults: { loadW: 3000, ratedCurrentA: 16, poles: '1P+N', ipRating: 'IP44' }, mount: 1100 },
    { key: 'outlet.waterproof', name: 'Outdoor waterproof outlet', prefix: 'P', primitives: [...socket(), earthBar, badge('IP')], fields: [loadW, ipRating, earthed], defaults: { loadW: 200, ipRating: 'IP44', earthed: true }, mount: 500 },
    { key: 'outlet.appliance', name: 'Dedicated appliance outlet', prefix: 'P', primitives: [...socket(true), earthBar], fields: [loadW, ipRating, earthed, { key: 'appliance', label: 'Appliance', kind: 'text', maxLength: 80 }], defaults: { loadW: 2000, ipRating: 'IP20', earthed: true }, mount: 600, keywords: ['oven', 'washing', 'dishwasher'] },
    { key: 'outlet.usb', name: 'USB outlet', prefix: 'P', primitives: [...socket(), earthBar, badge('USB')], fields: [loadW, earthed], defaults: { loadW: 60, earthed: true }, mount: 300 },
    { key: 'outlet.three-phase', name: 'Three-phase outlet', prefix: 'P', primitives: [...socket(), earthBar, L(-1, 1.6, 1, 0.9), L(-1, 2.2, 1, 1.5), L(-1, 2.8, 1, 2.1)], fields: [loadW, ratedA, poles, ipRating], defaults: { loadW: 7000, ratedCurrentA: 16, poles: '3P+N', ipRating: 'IP44' }, mount: 1100, keywords: ['400V', 'cee'] },
  ]),
  ...group('switches', [
    { key: 'switch.single', name: 'Single switch', prefix: 'S', primitives: switchBase(1), fields: [ipRating], defaults: { ipRating: 'IP20' }, mount: 1050, keywords: ['one-way'] },
    { key: 'switch.double', name: 'Double switch', prefix: 'S', primitives: switchBase(2), fields: [ipRating], defaults: { ipRating: 'IP20' }, mount: 1050, keywords: ['two-gang'] },
    { key: 'switch.triple', name: 'Triple switch', prefix: 'S', primitives: switchBase(3), fields: [ipRating], defaults: { ipRating: 'IP20' }, mount: 1050, keywords: ['three-gang'] },
    { key: 'switch.two-way', name: 'Two-way switch', prefix: 'S', primitives: [L(-3.2, 3.2, 3.2, -3.2), L(3.2, -3.2, 4.3, -2.1), L(-3.2, 3.2, -4.3, 2.1), C(1)], hit: 3.6, fields: [ipRating], defaults: { ipRating: 'IP20' }, mount: 1050, keywords: ['changeover'] },
    { key: 'switch.intermediate', name: 'Intermediate switch', prefix: 'S', primitives: [L(-3.2, 3.2, 3.2, -3.2), L(-3.2, -3.2, 3.2, 3.2), L(3.2, -3.2, 4.3, -2.1), L(-3.2, 3.2, -4.3, 2.1), L(3.2, 3.2, 4.3, 2.1), L(-3.2, -3.2, -4.3, -2.1), C(1)], hit: 3.6, fields: [ipRating], defaults: { ipRating: 'IP20' }, mount: 1050, keywords: ['crossover'] },
    { key: 'switch.staircase', name: 'Staircase timer switch', prefix: 'S', primitives: [...switchBase(1), badge('t')], fields: [ipRating, { key: 'delayS', label: 'Time delay', kind: 'number', unit: 's', min: 0, max: 3600 }], defaults: { ipRating: 'IP20', delayS: 120 }, mount: 1050, keywords: ['push button', 'timer'] },
    { key: 'switch.dimmer', name: 'Dimmer switch', prefix: 'S', primitives: [...switchBase(1), P('M -2.6 2.6 L 1.6 -1.6 M 0.6 -1.6 L 1.6 -1.6 L 1.6 -0.6')], fields: [ipRating, { key: 'maxLoadW', label: 'Max load', kind: 'number', unit: 'W', min: 0, max: 5000 }], defaults: { ipRating: 'IP20', maxLoadW: 400 }, mount: 1050 },
    { key: 'switch.smart', name: 'Smart switch', prefix: 'S', primitives: [...switchBase(1), badge('S')], fields: [ipRating], defaults: { ipRating: 'IP20' }, mount: 1050 },
  ]),
  ...group('distribution', [
    { key: 'board.main', name: 'Main distribution board', prefix: 'MDB', primitives: [box(9, 4.5), P('M -4.5 -2.25 L 4.5 2.25 L -4.5 2.25 Z', 'stroke')], hit: 4.6, fields: [ratedA, poles, ways], defaults: { ratedCurrentA: 63, poles: '3P+N', ways: 36 }, mount: 1500, keywords: ['panel', 'consumer unit', 'mdb'] },
    { key: 'board.sub', name: 'Sub-distribution board', prefix: 'SDB', primitives: [box(7, 3.6), L(-3.5, -1.8, 3.5, 1.8)], hit: 3.8, fields: [ratedA, poles, ways], defaults: { ratedCurrentA: 40, poles: '1P+N', ways: 18 }, mount: 1500, keywords: ['panel', 'sub board'] },
    { key: 'dist.junction-box', name: 'Junction box', prefix: 'JB', primitives: [C(1.3, 0, 0, 'stroke')], hit: 2, fields: [ipRating], defaults: { ipRating: 'IP54' }, keywords: ['joint', 'branch'] },
    { key: 'dist.breaker', name: 'Circuit breaker', prefix: 'Q', primitives: [box(5, 5), T('Q', 0, 0, 2.4)], fields: [ratedA, poles, curve], defaults: { ratedCurrentA: 16, poles: '1P', curve: 'B' }, keywords: ['mcb'] },
    { key: 'dist.rcd', name: 'RCD', prefix: 'F', primitives: [box(6, 5), T('RCD', 0, 0, 1.8)], fields: [ratedA, poles, residual, rcdType], defaults: { ratedCurrentA: 40, poles: '1P+N', residualCurrentMa: '30 mA', rcdType: 'A' }, keywords: ['rccb', 'fi'] },
    { key: 'dist.rcbo', name: 'RCBO', prefix: 'F', primitives: [box(7, 5), T('RCBO', 0, 0, 1.7)], fields: [ratedA, poles, curve, residual, rcdType], defaults: { ratedCurrentA: 16, poles: '1P+N', curve: 'B', residualCurrentMa: '30 mA', rcdType: 'A' } },
    { key: 'dist.spd', name: 'Surge protection device', prefix: 'FV', primitives: [box(6, 5), P('M -1.2 -1.8 L 0.4 -0.2 L -0.4 0.2 L 1.2 1.8'), badge('SPD')], fields: [poles, { key: 'spdType', label: 'SPD type', kind: 'select', options: ['T1', 'T1+T2', 'T2', 'T3'] }], defaults: { poles: '3P+N', spdType: 'T2' }, keywords: ['overvoltage', 'lightning'] },
    { key: 'dist.main-switch', name: 'Main disconnect switch', prefix: 'QS', primitives: [box(6, 5), T('0/I', 0, 0, 1.8)], fields: [ratedA, poles], defaults: { ratedCurrentA: 63, poles: '3P+N' }, keywords: ['isolator'] },
    { key: 'dist.meter', name: 'Energy meter', prefix: 'PM', primitives: [box(6, 5), T('kWh', 0, 0, 1.8)], fields: [poles], defaults: { poles: '3P+N' }, mount: 1700, keywords: ['metering'] },
  ]),
  ...group('communication', [
    { key: 'comm.rj45', name: 'Ethernet RJ45 outlet', prefix: 'TD', primitives: [...socket(), T('TD', 0, -1.1, 1.5)], fields: [{ key: 'category', label: 'Cable category', kind: 'select', options: ['Cat5e', 'Cat6', 'Cat6A', 'Cat7'] }, { key: 'ports', label: 'Ports', kind: 'number', min: 1, max: 4, integer: true }], defaults: { category: 'Cat6', ports: 1 }, mount: 300, keywords: ['data', 'network', 'lan'] },
    { key: 'comm.phone', name: 'Telephone outlet', prefix: 'TP', primitives: [...socket(), T('TP', 0, -1.1, 1.5)], mount: 300 },
    { key: 'comm.tv', name: 'TV / coaxial outlet', prefix: 'TV', primitives: [...socket(), T('TV', 0, -1.1, 1.5)], mount: 300, keywords: ['antenna', 'sat'] },
    { key: 'comm.wifi-ap', name: 'Wi-Fi access point', prefix: 'AP', primitives: [C(1.2, 0, 1.2, 'stroke'), P('M -2.2 -0.6 A 3 3 0 0 1 2.2 -0.6'), P('M -3.4 -2 A 4.6 4.6 0 0 1 3.4 -2')], fields: [{ key: 'poe', label: 'PoE powered', kind: 'boolean' }], defaults: { poe: true }, keywords: ['wireless'] },
    { key: 'comm.cctv', name: 'CCTV camera', prefix: 'CAM', primitives: [P('M -3.5 -1.6 H 1.5 V 1.6 H -3.5 Z', 'paper'), P('M 1.5 -0.8 L 3.6 -2 V 2 L 1.5 0.8 Z', 'paper')], fields: [{ key: 'resolution', label: 'Resolution', kind: 'select', options: ['2 MP', '4 MP', '8 MP'] }, { key: 'poe', label: 'PoE powered', kind: 'boolean' }], defaults: { resolution: '4 MP', poe: true }, mount: 2600, keywords: ['camera', 'security'] },
    { key: 'comm.motion', name: 'Motion detector', prefix: 'B', primitives: [C(1.4), P('M 2.2 -1.6 A 2.6 2.6 0 0 1 2.2 1.6'), P('M 3.3 -2.6 A 4 4 0 0 1 3.3 2.6')], mount: 2400, keywords: ['pir', 'sensor'] },
    { key: 'comm.doorbell', name: 'Doorbell', prefix: 'H', primitives: [P('M -2.6 1.3 A 2.6 2.6 0 0 1 2.6 1.3 Z', 'paper'), L(0, 1.3, 0, 2.6)], mount: 1300, keywords: ['bell', 'chime'] },
    { key: 'comm.intercom', name: 'Video intercom', prefix: 'VI', primitives: [box(4.6, 6), box(3, 2.6, 'none'), C(0.5, 0, 2, 'stroke')], hit: 3.4, mount: 1500, keywords: ['door station'] },
    { key: 'comm.alarm', name: 'Alarm sensor', prefix: 'AS', primitives: [box(5, 5), T('A', 0, 0, 2.4)], mount: 2200, keywords: ['intrusion', 'contact'] },
  ]),
  ...group('smart', [
    { key: 'smart.knx', name: 'KNX device', prefix: 'KNX', primitives: [box(7, 5), T('KNX', 0, 0, 1.8)], fields: [{ key: 'address', label: 'Physical address', kind: 'text', maxLength: 20 }] },
    { key: 'smart.relay', name: 'Smart relay', prefix: 'K', primitives: [box(5, 5), T('K', 0, 0, 2.4)], fields: [ratedA], defaults: { ratedCurrentA: 16 } },
    { key: 'smart.thermostat', name: 'Smart thermostat', prefix: 'TH', primitives: [C(2.6), T('T', 0, 0, 2.4)], mount: 1500 },
    { key: 'smart.presence', name: 'Presence sensor', prefix: 'PS', primitives: [C(1.4), P('M -2.2 -1.8 A 2.8 2.8 0 0 1 2.2 -1.8'), P('M -3.2 -3 A 4.4 4.4 0 0 1 3.2 -3')], keywords: ['occupancy'] },
    { key: 'smart.temperature', name: 'Temperature sensor', prefix: 'TS', primitives: [C(2.6), T('t°', 0, 0, 2.2)], mount: 1500 },
    { key: 'smart.lighting-controller', name: 'Smart lighting controller', prefix: 'LC', primitives: [box(6, 5), T('LC', 0, 0, 2)], fields: [{ key: 'channels', label: 'Channels', kind: 'number', min: 1, max: 64, integer: true }], defaults: { channels: 4 } },
    { key: 'smart.blind', name: 'Blind / shutter controller', prefix: 'M', primitives: [box(5, 5), P('M -1.4 -0.4 L 0 -1.8 L 1.4 -0.4 Z M -1.4 0.4 L 0 1.8 L 1.4 0.4 Z', 'stroke')], fields: [powerW], defaults: { powerW: 150 }, mount: 1050, keywords: ['roller', 'shutter'] },
    { key: 'smart.ufh', name: 'Underfloor heating control', prefix: 'UFH', primitives: [box(7, 5), T('UFH', 0, 0, 1.8)], fields: [powerW], defaults: { powerW: 1500 }, mount: 1500, keywords: ['heating'] },
    { key: 'smart.gateway', name: 'Home automation gateway', prefix: 'GW', primitives: [box(6, 5), T('GW', 0, 0, 2)], keywords: ['hub', 'controller'] },
  ]),
  ...group('renewable', [
    { key: 'energy.pv', name: 'Solar panel array', prefix: 'PV', primitives: [box(10, 6), L(-1.67, -3, -1.67, 3), L(1.67, -3, 1.67, 3), L(-5, 0, 5, 0), L(-5, 3, 5, -3)], hit: 5, fields: [{ key: 'peakPowerKwp', label: 'Peak power', kind: 'number', unit: 'kWp', min: 0, max: 10000 }, { key: 'panels', label: 'Panels', kind: 'number', min: 1, max: 10000, integer: true }], defaults: { peakPowerKwp: 5, panels: 12 }, keywords: ['pv', 'photovoltaic'] },
    { key: 'energy.inverter', name: 'Solar inverter', prefix: 'INV', primitives: [box(6, 6), L(-3, 3, 3, -3), T('=', -1.5, -1.3, 2), T('~', 1.5, 1.4, 2)], fields: [{ key: 'ratedPowerKw', label: 'Rated power', kind: 'number', unit: 'kW', min: 0, max: 1000 }], defaults: { ratedPowerKw: 5 }, mount: 1500 },
    { key: 'energy.battery', name: 'Battery storage', prefix: 'BAT', primitives: [box(7, 5), L(-1, -1.8, -1, 1.8), L(1, -0.9, 1, 0.9), L(-2.6, 0, -1, 0), L(1, 0, 2.6, 0)], fields: [{ key: 'capacityKwh', label: 'Capacity', kind: 'number', unit: 'kWh', min: 0, max: 10000 }], defaults: { capacityKwh: 10 } },
    { key: 'energy.ev-charger', name: 'EV charging station', prefix: 'EV', primitives: [box(6, 6), T('EV', 0, -0.6, 2), P('M -0.6 1.2 L 0.6 1.2 L 0 2.4 Z', 'stroke')], fields: [{ key: 'ratedPowerKw', label: 'Charging power', kind: 'number', unit: 'kW', min: 0, max: 400 }, poles], defaults: { ratedPowerKw: 11, poles: '3P+N' }, mount: 1200, keywords: ['wallbox', 'car'] },
    { key: 'energy.monitor', name: 'Energy monitoring system', prefix: 'EM', primitives: [box(6, 5), T('EM', 0, 0, 2)] },
    { key: 'energy.generator', name: 'Generator connection', prefix: 'G', primitives: [C(2.8), T('G', 0, 0, 2.6)], fields: [{ key: 'ratedPowerKva', label: 'Rated power', kind: 'number', unit: 'kVA', min: 0, max: 10000 }, poles], defaults: { ratedPowerKva: 10, poles: '3P+N' }, keywords: ['backup'] },
  ]),
  ...group('annotation', [
    { key: 'annotation.note', name: 'Text note', prefix: 'N', primitives: [P('M -1.5 1.5 L 0 -1.5 L 1.5 1.5 Z', 'paper'), T('!', 0, 0.6, 1.6)], hit: 2.2, fields: [{ key: 'text', label: 'Note', kind: 'text', maxLength: 500 }], defaults: { text: 'Note' } },
  ]),
];

// ── lookup and validation ───────────────────────────────────────────────
const BY_KEY = new Map(COMPONENT_TYPES.map((t) => [t.key, t]));

export function componentType(key: string): ComponentType | undefined {
  return BY_KEY.get(key);
}

function fieldSchema(f: PropertyField): z.ZodType {
  switch (f.kind) {
    case 'number': {
      let s = z.number().finite();
      if (f.integer) s = s.int();
      if (f.min !== undefined) s = s.min(f.min, `${f.label} must be at least ${f.min}.`);
      if (f.max !== undefined) s = s.max(f.max, `${f.label} must be at most ${f.max}.`);
      return s.optional();
    }
    case 'select':
      return z.enum(f.options as [string, ...string[]]).optional();
    case 'text':
      return z.string().max(f.maxLength ?? 500).optional();
    case 'boolean':
      return z.boolean().optional();
  }
}

const schemaCache = new Map<string, z.ZodType>();

/** Zod schema for a type's `properties`. Unknown keys are removed. */
export function propertiesSchema(type: ComponentType): z.ZodType<Record<string, unknown>> {
  let s = schemaCache.get(type.key);
  if (!s) {
    s = z.object(Object.fromEntries(type.fields.map((f) => [f.key, fieldSchema(f)])));
    schemaCache.set(type.key, s);
  }
  return s as z.ZodType<Record<string, unknown>>;
}

/** Paper millimetres → plan units (PDF points). Symbols keep their paper size at any drawing scale. */
export const MM_TO_PT = 72 / 25.4;

/** Search the catalog by name, key or keyword (case-insensitive, all words must match). */
export function searchCatalog(query: string): ComponentType[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...COMPONENT_TYPES];
  return COMPONENT_TYPES.filter((t) => {
    const hay = `${t.name} ${t.key} ${(t.keywords ?? []).join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

