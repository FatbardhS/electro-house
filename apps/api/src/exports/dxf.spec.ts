import { inflateRawSync } from 'node:zlib';
import DxfParserModule from 'dxf-parser';
import { DEFAULT_CABLE, MM_TO_PT, createComponent, uuidv7, type FloorInstallationDto } from '@electro/shared';
import { blockName, floorToDxf, layerName, nearestAci } from './dxf.js';
import { zip } from './zip.js';

// dxf-parser's CommonJS build exports the class as its default export; its typings describe the ESM build.
const DxfParser = DxfParserModule as unknown as new () => { parseSync(source: string): unknown };

function sampleFloor(metresPerUnit: number | null): FloorInstallationDto {
  const board = { ...createComponent('board.main', { x: 100, y: 100 }, uuidv7(), []), label: 'MDB' };
  const lamp = { ...createComponent('light.ceiling', { x: 400, y: 100 }, uuidv7(), []), label: 'Llamba ë', rotation: 90 };
  const outlet = createComponent('outlet.double', { x: 400, y: 300 }, uuidv7(), []);
  return {
    floorId: uuidv7(),
    name: 'Kati përdhes',
    sortOrder: 0,
    metresPerUnit,
    calibrationNeedsCheck: false,
    hasPlan: true,
    ceilingHeightMm: 2600,
    cableRouting: 'ceiling',
    components: [board, lamp, outlet],
    wires: [
      {
        id: uuidv7(),
        label: 'W1',
        from: { componentId: board.id, portId: null, x: 100, y: 100 },
        to: { componentId: lamp.id, portId: null, x: 400, y: 100 },
        points: [],
        cable: { ...DEFAULT_CABLE, lineStyle: 'dashed', color: '#b91c1c' },
        circuitId: null,
        description: null,
      },
    ],
  };
}

type Parsed = {
  tables: { layer: { layers: Record<string, { color: number }> } };
  blocks: Record<string, { entities?: { type: string }[] }>;
  entities: { type: string; layer: string; name?: string; position?: { x: number; y: number }; vertices?: { x: number; y: number }[]; lineType?: string; rotation?: number; xScale?: number; text?: string }[];
};

describe('DXF export', () => {
  it('writes a DXF R12 file that an independent parser reads: layers, blocks, inserts, wires', () => {
    const floor = sampleFloor(0.01);
    const dxf = floorToDxf({ floor, projectName: 'Shtëpia', companyName: 'Demo' });
    expect(dxf).toContain('AC1009');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    const parsed = new DxfParser().parseSync(dxf) as unknown as Parsed;

    expect(Object.keys(parsed.tables.layer.layers)).toEqual(expect.arrayContaining(['EH-LIGHTING', 'EH-OUTLETS', 'EH-WIRING', 'EH-DISTRIBUTION']));
    expect(Object.keys(parsed.blocks)).toEqual(expect.arrayContaining([blockName('board.main'), blockName('light.ceiling'), blockName('outlet.double')]));
    expect(parsed.blocks[blockName('light.ceiling')]!.entities!.length).toBeGreaterThan(0);

    const inserts = parsed.entities.filter((e) => e.type === 'INSERT');
    expect(inserts).toHaveLength(3);
    const lamp = inserts.find((e) => e.name === blockName('light.ceiling'))!;
    expect(lamp.layer).toBe(layerName('lighting'));
    // metres, y flipped, rotation mirrored for the y-up coordinate system, symbol mm scaled to metres
    expect(lamp.position!.x).toBeCloseTo(4, 6);
    expect(lamp.position!.y).toBeCloseTo(-1, 6);
    expect(lamp.rotation).toBeCloseTo(-90, 6);
    expect(lamp.xScale).toBeCloseTo(MM_TO_PT * 0.01, 9);

    const wire = parsed.entities.find((e) => e.type === 'POLYLINE' && e.layer === 'EH-WIRING')!;
    expect(wire.vertices!.map((v) => [v.x, v.y])).toEqual([
      [1, -1],
      [4, -1],
    ]);
    expect(wire.lineType).toBe('DASHED');
    expect(parsed.entities.some((e) => e.type === 'TEXT' && e.text?.startsWith('W1 NYM-J'))).toBe(true);
    // non-ASCII text is written as \U+XXXX escapes
    expect(dxf).toContain('Llamba \\U+00EB');
  });

  it('notes uncalibrated floors and keeps plan units', () => {
    const dxf = floorToDxf({ floor: sampleFloor(null), projectName: 'P', companyName: 'C' });
    expect(dxf).toContain('not to scale');
    const parsed = new DxfParser().parseSync(dxf) as unknown as Parsed;
    const board = parsed.entities.find((e) => e.type === 'INSERT' && e.name === blockName('board.main'))!;
    expect(board.position).toMatchObject({ x: 100, y: -100 });
  });

  it('maps colours to the nearest AutoCAD colour', () => {
    expect(nearestAci('#ff0000')).toBe(1);
    expect(nearestAci('#1d4ed8')).toBe(150); // blue (0,127,255) is nearer than pure blue
    expect(nearestAci('#111827')).toBe(7);
  });
});

describe('ZIP writer', () => {
  it('writes entries that can be read back', () => {
    const files = [
      { name: '01-kati-perdhes.dxf', data: Buffer.from('first file') },
      { name: '01-kati-perdhes.dxf', data: Buffer.from('second, same name') },
    ];
    const z = zip(files);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(z.readUInt16LE(z.length - 12)).toBe(2);
    // walk the local headers
    const names: string[] = [];
    const contents: string[] = [];
    let p = 0;
    while (z.readUInt32LE(p) === 0x04034b50) {
      const size = z.readUInt32LE(p + 18);
      const nameLen = z.readUInt16LE(p + 26);
      names.push(z.subarray(p + 30, p + 30 + nameLen).toString('utf8'));
      contents.push(inflateRawSync(z.subarray(p + 30 + nameLen, p + 30 + nameLen + size)).toString());
      p += 30 + nameLen + size;
    }
    expect(names).toEqual(['01-kati-perdhes.dxf', '01-kati-perdhes-2.dxf']);
    expect(contents).toEqual(['first file', 'second, same name']);
  });
});
