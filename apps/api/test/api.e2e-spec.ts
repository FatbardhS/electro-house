import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { ClientDto, FloorDto, ProjectDto } from '@electro/shared';
import { makePdf } from './pdf-fixture.js';
import * as shared from '@electro/shared';

// Runs against the database configured in apps/api/.env. Each run uses fresh, unique accounts.
if (existsSync('.env')) process.loadEnvFile('.env');

let app: INestApplication<App>;

beforeAll(async () => {
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app as NestExpressApplication);
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

async function signUp(company: string) {
  const agent = request.agent(app.getHttpServer());
  const email = `test-${randomUUID()}@example.com`;
  const res = await agent
    .post('/api/auth/sign-up')
    .send({ name: 'Test Electrician', email, password: 'correct horse battery', organizationName: company })
    .expect(201);
  expect(res.headers['set-cookie']?.[0]).toMatch(/eh_session=.*HttpOnly/i);
  return { agent, email };
}

describe('auth', () => {
  it('rejects requests without a session', async () => {
    const res = await request(app.getHttpServer()).get('/api/clients').expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, message: expect.stringMatching(/sign in/i) });
  });

  it('signs up, reads the session, signs out', async () => {
    const { agent } = await signUp('Spark Ltd');
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.organization).toMatchObject({ name: 'Spark Ltd', role: 'OWNER' });
    await agent.post('/api/auth/sign-out').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('rejects a wrong password with a generic message', async () => {
    const { email } = await signUp('Volt Co');
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({ email, password: 'wrong password!!' })
      .expect(401);
    expect(res.body.message).toBe('Email or password is incorrect.');
  });

  it('refuses state-changing requests from a foreign origin', async () => {
    const { agent } = await signUp('Origin Co');
    await agent.post('/api/clients').set('Origin', 'https://evil.example').send({ name: 'X' }).expect(403);
  });
});

describe('validation', () => {
  it('returns field errors for invalid input', async () => {
    const { agent } = await signUp('Validation Co');
    const res = await agent.post('/api/clients').send({ name: '', email: 'nope' }).expect(400);
    expect(res.body.fields).toMatchObject({ name: expect.any(String), email: expect.any(String) });
  });

  it('rejects malformed ids', async () => {
    const { agent } = await signUp('Id Co');
    await agent.get('/api/clients/not-a-uuid').expect(400);
  });
});

describe('organization scoping', () => {
  it('never exposes one company’s clients, projects or floors to another', async () => {
    const a = await signUp('Company A');
    const b = await signUp('Company B');

    const client = (await a.agent.post('/api/clients').send({ name: 'Hoxha Family' }).expect(201)).body as ClientDto;
    const project = (
      await a.agent.post('/api/projects').send({ clientId: client.id, name: 'House' }).expect(201)
    ).body as ProjectDto;
    const floor = (
      await a.agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Ground floor' }).expect(201)
    ).body as FloorDto;

    expect((await b.agent.get('/api/clients').expect(200)).body).toEqual([]);
    await b.agent.get(`/api/clients/${client.id}`).expect(404);
    await b.agent.get(`/api/projects/${project.id}`).expect(404);
    await b.agent.get(`/api/floors/${floor.id}`).expect(404);
    await b.agent.delete(`/api/floors/${floor.id}`).expect(404);
    // B cannot create a project under A's client
    await b.agent.post('/api/projects').send({ clientId: client.id, name: 'Steal' }).expect(404);
  });
});

describe('clients → projects → floors', () => {
  it('finds clients by name and blocks deleting a client with projects', async () => {
    const { agent } = await signUp('Search Co');
    const c1 = (await agent.post('/api/clients').send({ name: 'Berisha Construction' }).expect(201)).body;
    await agent.post('/api/clients').send({ name: 'Krasniqi' }).expect(201);
    const found = (await agent.get('/api/clients').query({ search: 'beri' }).expect(200)).body as ClientDto[];
    expect(found.map((c) => c.name)).toEqual(['Berisha Construction']);

    await agent.post('/api/projects').send({ clientId: c1.id, name: 'Office' }).expect(201);
    const res = await agent.delete(`/api/clients/${c1.id}`).expect(409);
    expect(res.body.message).toMatch(/still has 1 project/);
  });

  it('adds, renames, reorders and deletes floors', async () => {
    const { agent } = await signUp('Floors Co');
    const client = (await agent.post('/api/clients').send({ name: 'C' }).expect(201)).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'P' }).expect(201)).body;
    const ground = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Ground floor' })).body;
    const first = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'First floor' })).body;
    const base = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Basement' })).body;

    await agent.patch(`/api/floors/${first.id}/name`).send({ name: 'Upper floor' }).expect(200);
    const ordered = (
      await agent.put(`/api/projects/${project.id}/floors/order`).send({ floorIds: [base.id, ground.id, first.id] })
    ).body as FloorDto[];
    expect(ordered.map((f) => f.name)).toEqual(['Basement', 'Ground floor', 'Upper floor']);

    // incomplete list is rejected
    await agent.put(`/api/projects/${project.id}/floors/order`).send({ floorIds: [base.id] }).expect(400);

    await agent.delete(`/api/floors/${base.id}`).expect(204);
    const detail = (await agent.get(`/api/projects/${project.id}`).expect(200)).body as ProjectDto;
    expect(detail.floors.map((f) => f.name)).toEqual(['Ground floor', 'Upper floor']);
  });
});

describe('plan upload and floor settings', () => {
  async function floorFor(agent: ReturnType<typeof request.agent>) {
    const client = (await agent.post('/api/clients').send({ name: 'C' })).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'P' })).body;
    return (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Ground floor' })).body as FloorDto;
  }

  it('accepts a real PDF, reads its page count and serves it back', async () => {
    const { agent } = await signUp('Upload Co');
    const floor = await floorFor(agent);
    const res = await agent
      .put(`/api/floors/${floor.id}/plan`)
      .attach('file', makePdf(3), { filename: 'Kati përdhes.pdf', contentType: 'application/pdf' })
      .expect(200);
    expect(res.body.planFile).toMatchObject({ pageCount: 3, originalName: 'Kati përdhes.pdf' });
    expect(res.body.revision).toBe(1);

    const { url } = (await agent.get(`/api/floors/${floor.id}/plan-url`).expect(200)).body;
    if (url.startsWith('/api/')) {
      const pdf = await agent.get(url).set('Range', 'bytes=0-4').expect(206);
      expect(pdf.headers['content-type']).toContain('application/pdf');
    }
  });

  it('rejects files that are not PDFs, even with a .pdf name', async () => {
    const { agent } = await signUp('Bad Upload Co');
    const floor = await floorFor(agent);
    const res = await agent
      .put(`/api/floors/${floor.id}/plan`)
      .attach('file', Buffer.from('MZ fake exe'), { filename: 'plan.pdf', contentType: 'application/pdf' })
      .expect(400);
    expect(res.body.message).toBe('This file is not a PDF.');
    await agent.put(`/api/floors/${floor.id}/plan`).expect(400);
  });

  it('flags calibration for checking when the plan is replaced', async () => {
    const { agent } = await signUp('Replace Co');
    const floor = await floorFor(agent);
    await agent.put(`/api/floors/${floor.id}/plan`).attach('file', makePdf(1), 'a.pdf').expect(200);
    const calibrated = (
      await agent
        .patch(`/api/floors/${floor.id}/settings`)
        .send({
          baseRevision: 1,
          calibration: {
            method: 'paper-scale',
            paperScale: 50,
            metresPerUnit: 0.0176,
            calibratedAt: new Date().toISOString(),
          },
        })
        .expect(200)
    ).body as FloorDto;
    expect(calibrated.calibrationNeedsCheck).toBe(false);

    const replaced = (await agent.put(`/api/floors/${floor.id}/plan`).attach('file', makePdf(1), 'b.pdf').expect(200))
      .body as FloorDto;
    expect(replaced.calibration).not.toBeNull();
    expect(replaced.calibrationNeedsCheck).toBe(true);
  });

  it('saves settings with optimistic concurrency and validates them', async () => {
    const { agent } = await signUp('Settings Co');
    const floor = await floorFor(agent);
    await agent.put(`/api/floors/${floor.id}/plan`).attach('file', makePdf(2), 'p.pdf').expect(200);

    const saved = (
      await agent.patch(`/api/floors/${floor.id}/settings`).send({ baseRevision: 1, planRotation: 90, planPage: 2 })
    ).body as FloorDto;
    expect(saved).toMatchObject({ planRotation: 90, planPage: 2, revision: 2 });

    // stale revision → conflict, nothing changed
    await agent.patch(`/api/floors/${floor.id}/settings`).send({ baseRevision: 1, planRotation: 180 }).expect(409);
    expect((await agent.get(`/api/floors/${floor.id}`)).body.planRotation).toBe(90);

    await agent.patch(`/api/floors/${floor.id}/settings`).send({ baseRevision: 2, planPage: 3 }).expect(400);
    await agent.patch(`/api/floors/${floor.id}/settings`).send({ baseRevision: 2, planRotation: 45 }).expect(400);
  });
});

describe('drawing (components and layers)', () => {
  async function setup(company: string) {
    const { agent } = await signUp(company);
    const client = (await agent.post('/api/clients').send({ name: 'C' })).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'P' })).body;
    const floor = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Ground floor' })).body as FloorDto;
    return { agent, floor, project };
  }
  const { createComponent, uuidv7 } = shared;

  it('starts empty with default layers', async () => {
    const { agent, floor } = await setup('Drawing Empty Co');
    const d = (await agent.get(`/api/floors/${floor.id}/drawing`).expect(200)).body;
    expect(d).toMatchObject({ floorId: floor.id, revision: 0, components: [] });
    expect(d.layers).toHaveLength(8);
    expect(d.layers.every((l: { visible: boolean; locked: boolean }) => l.visible && !l.locked)).toBe(true);
  });

  it('saves, updates and deletes components exactly, with layer state', async () => {
    const { agent, floor } = await setup('Drawing Save Co');
    const a = createComponent('outlet.double', { x: 120.5, y: 340.25 }, uuidv7(), []);
    const b = { ...createComponent('switch.two-way', { x: 10, y: 20 }, uuidv7(), []), rotation: 450 };
    const r1 = await agent
      .patch(`/api/floors/${floor.id}/drawing`)
      .send({ baseRevision: 0, ops: [{ op: 'upsert', component: a }, { op: 'upsert', component: b }, { op: 'layer', key: 'outlets', locked: true }] })
      .expect(200);
    expect(r1.body.revision).toBe(1);

    let d = (await agent.get(`/api/floors/${floor.id}/drawing`)).body;
    expect(d.components).toHaveLength(2);
    expect(d.components.find((c: { id: string }) => c.id === a.id)).toEqual(a);
    expect(d.components.find((c: { id: string }) => c.id === b.id).rotation).toBe(90); // normalised
    expect(d.layers.find((l: { key: string }) => l.key === 'outlets')).toEqual({ key: 'outlets', visible: true, locked: true });

    await agent
      .patch(`/api/floors/${floor.id}/drawing`)
      .send({ baseRevision: 1, ops: [{ op: 'upsert', component: { ...a, x: 200, label: 'P99' } }, { op: 'delete', id: b.id }] })
      .expect(200);
    d = (await agent.get(`/api/floors/${floor.id}/drawing`)).body;
    expect(d.revision).toBe(2);
    expect(d.components).toEqual([{ ...a, x: 200, label: 'P99' }]);
  });

  it('rejects stale revisions, unknown types and invalid properties without changing anything', async () => {
    const { agent, floor } = await setup('Drawing Reject Co');
    const a = createComponent('light.ceiling', { x: 1, y: 1 }, uuidv7(), []);
    await agent.patch(`/api/floors/${floor.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'upsert', component: a }] }).expect(200);
    await agent.patch(`/api/floors/${floor.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'delete', id: a.id }] }).expect(409);
    const bad1 = await agent
      .patch(`/api/floors/${floor.id}/drawing`)
      .send({ baseRevision: 1, ops: [{ op: 'upsert', component: { ...a, typeKey: 'light.laser' } }] })
      .expect(400);
    expect(bad1.body.message).toContain('Unknown component type');
    const bad2 = await agent
      .patch(`/api/floors/${floor.id}/drawing`)
      .send({ baseRevision: 1, ops: [{ op: 'upsert', component: { ...a, properties: { powerW: -3 } } }] })
      .expect(400);
    expect(bad2.body.message).toMatch(/Power must be at least 0/);
    const d = (await agent.get(`/api/floors/${floor.id}/drawing`)).body;
    expect(d).toMatchObject({ revision: 1, components: [a] });
  });

  it('keeps drawings private to the company and to the floor', async () => {
    const one = await setup('Drawing Owner Co');
    const other = await setup('Drawing Other Co');
    const a = createComponent('switch.single', { x: 5, y: 5 }, uuidv7(), []);
    await one.agent.patch(`/api/floors/${one.floor.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'upsert', component: a }] }).expect(200);
    await other.agent.get(`/api/floors/${one.floor.id}/drawing`).expect(404);
    await other.agent.patch(`/api/floors/${one.floor.id}/drawing`).send({ baseRevision: 1, ops: [{ op: 'delete', id: a.id }] }).expect(404);
    // Re-using another floor's component id on your own floor must not move/overwrite it.
    await other.agent
      .patch(`/api/floors/${other.floor.id}/drawing`)
      .send({ baseRevision: 0, ops: [{ op: 'upsert', component: { ...a, x: 999 } }] })
      .expect(400);
    const d = (await one.agent.get(`/api/floors/${one.floor.id}/drawing`)).body;
    expect(d.components[0].x).toBe(5);
  });

  it('settings and drawing autosaves do not conflict with each other', async () => {
    const { agent, floor } = await setup('Drawing Rev Co');
    await agent.patch(`/api/floors/${floor.id}/settings`).send({ baseRevision: 0, planRotation: 90 }).expect(200);
    const a = createComponent('switch.single', { x: 5, y: 5 }, uuidv7(), []);
    await agent.patch(`/api/floors/${floor.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'upsert', component: a }] }).expect(200);
  });
});

describe('wires', () => {
  async function setup(company: string) {
    const { agent } = await signUp(company);
    const client = (await agent.post('/api/clients').send({ name: 'C' })).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'P' })).body;
    const floor = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Ground floor' })).body as FloorDto;
    return { agent, floor };
  }
  const { createComponent, uuidv7, DEFAULT_CABLE } = shared;
  const wireBetween = (a: { id: string; x: number; y: number }, b: { id: string; x: number; y: number }) => ({
    id: uuidv7(),
    label: 'W1',
    from: { componentId: a.id, portId: 'p', x: a.x, y: a.y },
    to: { componentId: b.id, portId: 'p', x: b.x, y: b.y },
    points: [{ x: a.x, y: b.y }],
    cable: { ...DEFAULT_CABLE },
    circuitId: null,
    description: null,
  });

  it('saves components and the wire between them in one batch and returns them exactly', async () => {
    const { agent, floor } = await setup('Wire Save Co');
    const sw = createComponent('switch.single', { x: 10, y: 10 }, uuidv7(), []);
    const lamp = createComponent('light.ceiling', { x: 200, y: 300 }, uuidv7(), []);
    const w = wireBetween(sw, lamp);
    await agent
      .patch(`/api/floors/${floor.id}/drawing`)
      .send({ baseRevision: 0, ops: [{ op: 'upsertWire', wire: w }, { op: 'upsert', component: sw }, { op: 'upsert', component: lamp }] })
      .expect(200);
    const d = (await agent.get(`/api/floors/${floor.id}/drawing`)).body;
    expect(d.wires).toEqual([w]);
  });

  it('refuses to delete a component that still has a wire attached, but allows deleting both together', async () => {
    const { agent, floor } = await setup('Wire Delete Co');
    const sw = createComponent('switch.single', { x: 10, y: 10 }, uuidv7(), []);
    const lamp = createComponent('light.ceiling', { x: 200, y: 300 }, uuidv7(), []);
    const w = wireBetween(sw, lamp);
    await agent
      .patch(`/api/floors/${floor.id}/drawing`)
      .send({ baseRevision: 0, ops: [{ op: 'upsert', component: sw }, { op: 'upsert', component: lamp }, { op: 'upsertWire', wire: w }] })
      .expect(200);
    const res = await agent.patch(`/api/floors/${floor.id}/drawing`).send({ baseRevision: 1, ops: [{ op: 'delete', id: lamp.id }] }).expect(400);
    expect(res.body.message).toMatch(/Disconnect or delete the wires/);
    // Detaching the end in the same batch makes the delete valid.
    const detached = { ...w, to: { componentId: null, portId: null, x: lamp.x, y: lamp.y } };
    await agent
      .patch(`/api/floors/${floor.id}/drawing`)
      .send({ baseRevision: 1, ops: [{ op: 'upsertWire', wire: detached }, { op: 'delete', id: lamp.id }] })
      .expect(200);
    const d = (await agent.get(`/api/floors/${floor.id}/drawing`)).body;
    expect(d.components.map((c: { id: string }) => c.id)).toEqual([sw.id]);
    expect(d.wires[0].to.componentId).toBeNull();
  });

  it('rejects wires connected to components that are not on this floor', async () => {
    const one = await setup('Wire Foreign A');
    const other = await setup('Wire Foreign B');
    const theirs = createComponent('switch.single', { x: 1, y: 1 }, uuidv7(), []);
    await other.agent.patch(`/api/floors/${other.floor.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'upsert', component: theirs }] }).expect(200);
    const mine = createComponent('light.ceiling', { x: 5, y: 5 }, uuidv7(), []);
    const res = await one.agent
      .patch(`/api/floors/${one.floor.id}/drawing`)
      .send({ baseRevision: 0, ops: [{ op: 'upsert', component: mine }, { op: 'upsertWire', wire: wireBetween(theirs, mine) }] })
      .expect(400);
    expect(res.body.message).toMatch(/does not exist on this floor/);
  });
});

describe('circuits, boards and floor connections', () => {
  const { createComponent, uuidv7, DEFAULT_CIRCUIT, DEFAULT_CABLE, circuitLoads } = shared;
  async function setup(company: string) {
    const { agent } = await signUp(company);
    const client = (await agent.post('/api/clients').send({ name: 'C' })).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'P' })).body;
    const ground = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Ground floor' })).body as FloorDto;
    const first = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'First floor' })).body as FloorDto;
    return { agent, project, ground, first };
  }

  it('creates a circuit fed from a board, assigns components and computes the load', async () => {
    const { agent, project, ground } = await setup('Circuit Co');
    const board = createComponent('board.main', { x: 0, y: 0 }, uuidv7(), []);
    const lamp = { ...createComponent('light.ceiling', { x: 10, y: 10 }, uuidv7(), []), properties: { powerW: 2300 } };
    await agent.patch(`/api/floors/${ground.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'upsert', component: board }, { op: 'upsert', component: lamp }] }).expect(200);

    const circuit = (await agent.post(`/api/projects/${project.id}/circuits`).send({ ...DEFAULT_CIRCUIT, boardComponentId: board.id }).expect(201)).body;
    await agent
      .patch(`/api/floors/${ground.id}/drawing`)
      .send({ baseRevision: 1, ops: [{ op: 'upsert', component: { ...lamp, circuitId: circuit.id } }] })
      .expect(200);

    const inst = (await agent.get(`/api/projects/${project.id}/installation`).expect(200)).body;
    expect(inst.circuits).toHaveLength(1);
    const [load] = circuitLoads(inst);
    expect(load).toMatchObject({ componentCount: 1, loadW: 2300 });
    expect(load.designCurrentA).toBeCloseTo(10, 6);
  });

  it('only accepts real distribution boards of the same project and circuits of the same project', async () => {
    const { agent, project, ground } = await setup('Circuit Check Co');
    const lamp = createComponent('light.ceiling', { x: 10, y: 10 }, uuidv7(), []);
    await agent.patch(`/api/floors/${ground.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'upsert', component: lamp }] }).expect(200);
    const res = await agent.post(`/api/projects/${project.id}/circuits`).send({ ...DEFAULT_CIRCUIT, boardComponentId: lamp.id }).expect(400);
    expect(res.body.message).toMatch(/only be fed from a distribution board/);

    const other = await setup('Circuit Other Co');
    const foreign = (await other.agent.post(`/api/projects/${other.project.id}/circuits`).send(DEFAULT_CIRCUIT).expect(201)).body;
    await agent
      .patch(`/api/floors/${ground.id}/drawing`)
      .send({ baseRevision: 1, ops: [{ op: 'upsert', component: { ...lamp, circuitId: foreign.id } }] })
      .expect(400);
    await agent.patch(`/api/circuits/${foreign.id}`).send({ name: 'x' }).expect(404);
  });

  it('links components on different floors, refuses same-floor links, and keeps components when a circuit is deleted', async () => {
    const { agent, project, ground, first } = await setup('Link Co');
    const main = createComponent('board.main', { x: 0, y: 0 }, uuidv7(), []);
    const sub = createComponent('board.sub', { x: 0, y: 0 }, uuidv7(), []);
    const jb = createComponent('dist.junction-box', { x: 5, y: 5 }, uuidv7(), []);
    await agent.patch(`/api/floors/${ground.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'upsert', component: main }, { op: 'upsert', component: jb }] }).expect(200);
    await agent.patch(`/api/floors/${first.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'upsert', component: sub }] }).expect(200);
    const link = { fromComponentId: main.id, toComponentId: sub.id, lengthM: 6.5, cable: { ...DEFAULT_CABLE, conductors: 5, crossSectionMm2: 6 }, circuitId: null, description: null };
    const created = (await agent.post(`/api/projects/${project.id}/links`).send(link).expect(201)).body;
    expect(created).toMatchObject({ lengthM: 6.5, fromComponentId: main.id });
    await agent.post(`/api/projects/${project.id}/links`).send({ ...link, toComponentId: jb.id }).expect(400);

    const circuit = (await agent.post(`/api/projects/${project.id}/circuits`).send({ ...DEFAULT_CIRCUIT, boardComponentId: sub.id }).expect(201)).body;
    await agent.patch(`/api/links/${created.id}`).send({ circuitId: circuit.id }).expect(200);
    await agent.delete(`/api/circuits/${circuit.id}`).expect(204);
    const inst = (await agent.get(`/api/projects/${project.id}/installation`)).body;
    expect(inst.links[0].circuitId).toBeNull();
    expect(inst.floors.flatMap((f: { components: unknown[] }) => f.components)).toHaveLength(3);
  });

  it('stores the electrical rules profile per project', async () => {
    const { agent, project } = await setup('Profile Co');
    const profile = { name: 'My rules', maxBreakerByCrossSection: { '1.5': 16, '2.5': 20 }, powerFactor: 0.95 };
    await agent.put(`/api/projects/${project.id}/electrical-profile`).send(profile).expect(200);
    await agent.put(`/api/projects/${project.id}/electrical-profile`).send({ ...profile, powerFactor: 3 }).expect(400);
    expect((await agent.get(`/api/projects/${project.id}/installation`)).body.profile).toEqual(profile);
  });
});

describe('price list, material rules and company settings', () => {
  const { DEFAULT_ORGANIZATION_SETTINGS, EMPTY_COST_SETTINGS } = shared;
  const box = { code: 'B-60', name: 'Flush box 60', unit: 'pcs', unitPrice: 0.45, packSize: null, category: 'Boxes', archived: false };

  it('starts with default settings and saves valid ones only', async () => {
    const { agent } = await signUp('Settings Co');
    expect((await agent.get('/api/organization/settings').expect(200)).body).toEqual(DEFAULT_ORGANIZATION_SETTINGS);
    const next = { ...DEFAULT_ORGANIZATION_SETTINGS, currency: 'CHF', vatPct: 8.1, company: { ...DEFAULT_ORGANIZATION_SETTINGS.company, phone: '+41 00' } };
    await agent.put('/api/organization/settings').send(next).expect(200);
    await agent.put('/api/organization/settings').send({ ...next, currency: 'euro' }).expect(400);
    expect((await agent.get('/api/organization/settings')).body).toEqual(next);
  });

  it('creates, updates and protects materials; prices keep their decimals', async () => {
    const { agent } = await signUp('Materials Co');
    const m = (await agent.post('/api/materials').send(box).expect(201)).body;
    expect(m).toMatchObject({ code: 'B-60', unitPrice: 0.45, packSize: null });
    await agent.post('/api/materials').send({ ...box, name: 'Other' }).expect(409);
    const upd = (await agent.patch(`/api/materials/${m.id}`).send({ unitPrice: 0.4567 }).expect(200)).body;
    expect(upd.unitPrice).toBe(0.4567);

    const rule = (await agent.post('/api/material-rules').send({ target: 'component:outlet.double', materialId: m.id, quantity: 1, labourMinutes: 12.5 }).expect(201)).body;
    expect(rule).toMatchObject({ quantity: 1, labourMinutes: 12.5 });
    await agent.post('/api/material-rules').send({ target: 'socket', materialId: m.id, quantity: 1, labourMinutes: 0 }).expect(400);
    await agent.delete(`/api/materials/${m.id}`).expect(409);
    await agent.delete(`/api/material-rules/${rule.id}`).expect(204);
    await agent.delete(`/api/materials/${m.id}`).expect(204);
  });

  it('previews and applies a CSV import, matching rows by code', async () => {
    const { agent } = await signUp('Import Co');
    await agent.post('/api/materials').send(box).expect(201);
    const csv = 'Code;Name;Unit;Price;Pack size\nB-60;Flush box 60;pcs;0,50;\nN-315;NYM-J 3×1,5;m;0,62;100\n';
    const preview = (await agent.post('/api/materials/import').send({ csv, apply: false }).expect(200)).body;
    expect(preview).toEqual({ created: 1, updated: 1, errors: [], applied: false });
    expect((await agent.get('/api/materials')).body).toHaveLength(1);
    const done = (await agent.post('/api/materials/import').send({ csv, apply: true }).expect(200)).body;
    expect(done.applied).toBe(true);
    const list = (await agent.get('/api/materials')).body as shared.MaterialDto[];
    expect(list.map((m) => [m.code, m.unitPrice, m.packSize])).toEqual(
      expect.arrayContaining([['B-60', 0.5, null], ['N-315', 0.62, 100]]),
    );
    const bad = (await agent.post('/api/materials/import').send({ csv: csv + 'X;Bad;pcs;abc;\n', apply: true }).expect(200)).body;
    expect(bad).toMatchObject({ applied: false, errors: [{ line: 4 }] });

    const exported = await agent.get('/api/materials/export').expect(200);
    expect(exported.headers['content-type']).toMatch(/text\/csv/);
    expect(exported.text).toContain('NYM-J 3×1,5');
  });

  it('keeps price lists private to each company', async () => {
    const a = await signUp('Private Prices A');
    const b = await signUp('Private Prices B');
    const m = (await a.agent.post('/api/materials').send(box).expect(201)).body;
    expect((await b.agent.get('/api/materials')).body).toEqual([]);
    await b.agent.patch(`/api/materials/${m.id}`).send({ unitPrice: 0 }).expect(404);
    await b.agent.post('/api/material-rules').send({ target: 'component:outlet.double', materialId: m.id, quantity: 1, labourMinutes: 0 }).expect(400);
  });

  it('adds example materials once', async () => {
    const { agent } = await signUp('Examples Co');
    const first = (await agent.post('/api/materials/examples').expect(200)).body.added;
    expect(first).toBeGreaterThan(0);
    expect((await agent.post('/api/materials/examples').expect(200)).body.added).toBe(0);
  });

  it('stores project cost settings and floor heights without touching floor revisions', async () => {
    const { agent } = await signUp('Cost Co');
    const client = (await agent.post('/api/clients').send({ name: 'C' })).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'P' })).body;
    const floor = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Ground floor' })).body as FloorDto;
    const cost = { ...EMPTY_COST_SETTINGS, markupPct: 15, extraHours: 3, extraLines: [{ text: 'Testing', amount: 80 }] };
    await agent.put(`/api/projects/${project.id}/cost-settings`).send(cost).expect(200);
    await agent.put(`/api/projects/${project.id}/cost-settings`).send({ ...cost, extraLines: [{ text: '', amount: 1 }] }).expect(400);
    await agent.put(`/api/floors/${floor.id}/heights`).send({ ceilingHeightMm: 2800, cableRouting: 'floor' }).expect(200);
    await agent.put(`/api/floors/${floor.id}/heights`).send({ ceilingHeightMm: 100, cableRouting: 'floor' }).expect(400);
    const inst = (await agent.get(`/api/projects/${project.id}/installation`)).body;
    expect(inst.costSettings).toEqual(cost);
    expect(inst.floors[0]).toMatchObject({ ceilingHeightMm: 2800, cableRouting: 'floor' });
    const after = (await agent.get(`/api/projects/${project.id}`)).body as ProjectDto;
    expect(after.floors[0]!.revision).toBe(floor.revision);
  });
});

describe('PDF export', () => {
  const { createComponent, uuidv7, DEFAULT_CABLE, DEFAULT_EXPORT_OPTIONS } = shared;

  async function textOf(bytes: Buffer): Promise<{ pages: number; text: string[] }> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    const text: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      text.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
    }
    return { pages: doc.numPages, text };
  }

  it('exports plans over the embedded vector plan page, plus schedules, BOM and costs', async () => {
    const { agent } = await signUp('Export Ëlectric');
    const client = (await agent.post('/api/clients').send({ name: 'Familja Krasniqi' })).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'Shtëpia 2026', propertyAddress: 'Rr. Agim Ramadani 5' })).body;
    const floor = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Kati përdhes' })).body as FloorDto;
    await agent.put(`/api/floors/${floor.id}/plan`).attach('file', makePdf(1), 'plan.pdf').expect(200);
    const metresPerUnit = (100 * 25.4) / 72 / 1000; // 1:100 plan
    await agent
      .patch(`/api/floors/${floor.id}/settings`)
      .send({ baseRevision: 1, calibration: { method: 'paper-scale', paperScale: 100, metresPerUnit, calibratedAt: new Date().toISOString() } })
      .expect(200);

    const board = { ...createComponent('board.main', { x: 100, y: 100 }, uuidv7(), []), label: 'MDB' };
    const outlet = createComponent('outlet.double', { x: 400, y: 100 }, uuidv7(), []);
    const wire = {
      id: uuidv7(),
      label: 'W1',
      from: { componentId: board.id, portId: null, x: 100, y: 100 },
      to: { componentId: outlet.id, portId: null, x: 400, y: 100 },
      points: [],
      cable: DEFAULT_CABLE,
      circuitId: null,
      description: null,
    };
    await agent
      .patch(`/api/floors/${floor.id}/drawing`)
      .send({ baseRevision: 0, ops: [{ op: 'upsert', component: board }, { op: 'upsert', component: outlet }, { op: 'upsertWire', wire }] })
      .expect(200);
    await agent.post(`/api/projects/${project.id}/circuits`).send({ ...shared.DEFAULT_CIRCUIT, name: 'Prizat', boardComponentId: board.id }).expect(201);
    const m = (await agent.post('/api/materials').send({ code: 'S2', name: 'Prizë dyshe', unit: 'pcs', unitPrice: 7.5, packSize: null, category: null, archived: false })).body;
    await agent.post('/api/material-rules').send({ target: 'component:outlet.double', materialId: m.id, quantity: 1, labourMinutes: 15 }).expect(201);

    const res = await agent
      .post(`/api/projects/${project.id}/exports`)
      .send(DEFAULT_EXPORT_OPTIONS)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('.pdf');
    const bytes = res.body as Buffer;

    const { pages, text } = await textOf(bytes);
    // cover, 1 floor sheet, legend, circuits, boards, links, BOM, costs
    expect(pages).toBe(8);
    expect(text[0]).toContain('Shtëpia 2026');
    expect(text[0]).toContain('Familja Krasniqi');
    expect(text[1]).toContain('Kati përdhes');
    expect(text[1]).toMatch(/1:\d+/);
    expect(text[1]).toContain('MDB');
    expect(text[2]).toContain('Double outlet');
    expect(text[3]).toContain('Prizat');
    expect(text.join(' ')).toContain('Prizë dyshe');
    expect(text[7]).toContain('7.50 EUR');

    // The plan page is embedded as a vector form XObject, not as an image.
    const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
    const out = await PDFDocument.load(bytes);
    const resources = out.getPage(1).node.Resources()!;
    const xobjects = resources.lookup(PDFName.of('XObject'), PDFDict);
    const subtypes = xobjects.keys().map((k) => String((xobjects.lookup(k) as unknown as { dict: { get(n: unknown): unknown } }).dict.get(PDFName.of('Subtype'))));
    expect(subtypes).toContain('/Form');
    expect(subtypes).not.toContain('/Image');
  });

  it('honours sections and refuses other companies', async () => {
    const { agent } = await signUp('Export Sections Co');
    const client = (await agent.post('/api/clients').send({ name: 'C' })).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'P' })).body;
    const res = await agent
      .post(`/api/projects/${project.id}/exports`)
      .send({ ...DEFAULT_EXPORT_OPTIONS, sections: ['costs'] })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((await textOf(res.body as Buffer)).pages).toBe(1);
    await agent.post(`/api/projects/${project.id}/exports`).send({ ...DEFAULT_EXPORT_OPTIONS, sections: [] }).expect(400);
    const other = await signUp('Export Other Co');
    await other.agent.post(`/api/projects/${project.id}/exports`).send(DEFAULT_EXPORT_OPTIONS).expect(404);
  });
});
