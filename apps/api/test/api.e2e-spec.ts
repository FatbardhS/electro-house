import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Test as SuperTest } from 'supertest';
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
  app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
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
    // Profiles saved without the Phase 6 fields get their defaults.
    expect((await agent.get(`/api/projects/${project.id}/installation`)).body.profile).toEqual({ ...profile, maxVoltageDropPct: null, rcdRequiredCategories: [] });
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

describe('billing and read-only mode', () => {
  async function prisma() {
    const { PrismaService } = await import('../src/prisma/prisma.service.js');
    return app.get(PrismaService);
  }
  async function devProvider() {
    const { BILLING_PROVIDER } = await import('../src/billing/provider.js');
    return app.get(BILLING_PROVIDER) as import('../src/billing/dev-provider.js').DevBillingProvider;
  }
  async function orgIdOf(agent: ReturnType<typeof request.agent>): Promise<string> {
    return (await agent.get('/api/auth/me')).body.organization.id;
  }
  async function subscribe(agent: ReturnType<typeof request.agent>, interval: 'month' | 'year' = 'month') {
    const { url } = (await agent.post('/api/billing/checkout').send({ interval }).expect(200)).body;
    const token = new URL(url).searchParams.get('dev-checkout')!;
    return (await agent.post('/api/billing/dev/complete').send({ token }).expect(200)).body as shared.BillingDto;
  }

  it('starts a 14-day trial on sign-up', async () => {
    const { agent } = await signUp('Trial Co');
    const me = (await agent.get('/api/auth/me')).body;
    expect(me.organization.billing).toMatchObject({ status: 'trialing', access: 'full' });
    expect(shared.daysUntil(me.organization.billing.trialEndsAt)).toBe(14);
    expect((await agent.get('/api/billing').expect(200)).body).toMatchObject({ status: 'trialing', provider: 'dev', seats: 1, members: 1, hasSubscription: false });
  });

  it('makes an expired company read-only: reads and exports work, changes are refused with 402', async () => {
    const { agent } = await signUp('Expired Co');
    const client = (await agent.post('/api/clients').send({ name: 'C' }).expect(201)).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'P' }).expect(201)).body;
    const db = await prisma();
    await db.organization.update({ where: { id: await orgIdOf(agent) }, data: { trialEndsAt: new Date(Date.now() - 1000) } });

    expect((await agent.get('/api/auth/me')).body.organization.billing).toMatchObject({ status: 'expired', access: 'read-only' });
    const refused = await agent.post('/api/clients').send({ name: 'D' }).expect(402);
    expect(refused.body.message).toBe(shared.READ_ONLY_MESSAGE);
    await agent.patch(`/api/projects/${project.id}`).send({ name: 'Renamed' }).expect(402);
    await agent.get('/api/clients').expect(200);
    await agent.post(`/api/projects/${project.id}/exports`).send({ ...shared.DEFAULT_EXPORT_OPTIONS, sections: ['cover'] }).expect(200);

    // Subscribing works while read-only and restores full access.
    const billing = await subscribe(agent, 'year');
    expect(billing).toMatchObject({ status: 'active', access: 'full', interval: 'year', hasSubscription: true });
    await agent.post('/api/clients').send({ name: 'D' }).expect(201);
    await agent.post('/api/auth/sign-out').expect(204);
  });

  it('applies each webhook once and rejects bad signatures', async () => {
    const { agent } = await signUp('Webhook Co');
    await subscribe(agent);
    const org = await (await prisma()).organization.findUniqueOrThrow({ where: { id: await orgIdOf(agent) } });
    const dev = await devProvider();
    const delivery = dev.actionEvent('payment_failed', {
      id: org.providerSubscriptionId!,
      customerId: org.providerCustomerId,
      organizationId: org.id,
      status: 'active',
      interval: 'month',
      seats: 1,
      currentPeriodEnd: org.currentPeriodEnd,
      cancelAtPeriodEnd: false,
    });
    const post = () => request(app.getHttpServer()).post('/api/billing/webhooks/dev').set(delivery.headers).set('Content-Type', 'application/json').send(delivery.body.toString());
    expect((await post().expect(200)).body).toEqual({ received: true, duplicate: false });
    expect((await post().expect(200)).body).toEqual({ received: true, duplicate: true });
    expect((await agent.get('/api/billing')).body).toMatchObject({ status: 'past_due', access: 'full' });

    await request(app.getHttpServer())
      .post('/api/billing/webhooks/dev')
      .set({ 'x-dev-signature': 'f'.repeat(64) })
      .set('Content-Type', 'application/json')
      .send(delivery.body.toString())
      .expect(400);
    await request(app.getHttpServer()).post('/api/billing/webhooks/paddle').send({}).expect(404);
  });

  it('keeps access during the payment grace period and until a cancelled period ends', async () => {
    const { agent } = await signUp('Grace Co');
    await subscribe(agent);
    const db = await prisma();
    const id = await orgIdOf(agent);

    await agent.post('/api/billing/dev/simulate').send({ action: 'payment_failed' }).expect(200);
    await agent.post('/api/clients').send({ name: 'Still OK' }).expect(201);
    await db.organization.update({ where: { id }, data: { pastDueSince: new Date(Date.now() - 8 * 86_400_000) } });
    await agent.post('/api/clients').send({ name: 'Blocked' }).expect(402);

    await agent.post('/api/billing/dev/simulate').send({ action: 'payment_succeeded' }).expect(200);
    const cancelled = (await agent.post('/api/billing/dev/simulate').send({ action: 'cancel' }).expect(200)).body;
    expect(cancelled).toMatchObject({ status: 'canceled', access: 'full', cancelAtPeriodEnd: true });
    await agent.post('/api/clients').send({ name: 'OK until period end' }).expect(201);
    const ended = (await agent.post('/api/billing/dev/simulate').send({ action: 'end_now' }).expect(200)).body;
    expect(ended).toMatchObject({ status: 'expired', access: 'read-only' });
  });

  it('refuses another company’s checkout link and blocks a second subscription', async () => {
    const a = await signUp('Checkout A');
    const b = await signUp('Checkout B');
    const { url } = (await a.agent.post('/api/billing/checkout').send({ interval: 'month' }).expect(200)).body;
    const token = new URL(url).searchParams.get('dev-checkout')!;
    await b.agent.post('/api/billing/dev/complete').send({ token }).expect(403);
    await a.agent.post('/api/billing/dev/complete').send({ token }).expect(200);
    await a.agent.post('/api/billing/checkout').send({ interval: 'year' }).expect(400);
    expect((await a.agent.post('/api/billing/portal').expect(200)).body.url).toContain('dev-portal=1');
    await b.agent.post('/api/billing/portal').expect(400);
  });
});

describe('validation checks and DXF export', () => {
  const { createComponent, uuidv7, DEFAULT_CIRCUIT, DEFAULT_EXPORT_OPTIONS, runChecks, applyIgnored } = shared;
  const binary = (r: SuperTest) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  async function setup(company: string) {
    const { agent } = await signUp(company);
    const client = (await agent.post('/api/clients').send({ name: 'C' })).body;
    const project = (await agent.post('/api/projects').send({ clientId: client.id, name: 'Checks P' })).body;
    const floor = (await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Ground floor' })).body as FloorDto;
    const board = { ...createComponent('board.main', { x: 0, y: 0 }, uuidv7(), []), label: 'MDB' };
    const lonely = { ...createComponent('outlet.double', { x: 300, y: 0 }, uuidv7(), []), label: 'S1' };
    await agent.patch(`/api/floors/${floor.id}/drawing`).send({ baseRevision: 0, ops: [{ op: 'upsert', component: board }, { op: 'upsert', component: lonely }] }).expect(200);
    return { agent, project, floor, board, lonely };
  }

  it('stores the new rules (voltage drop, RCD categories) and ignores / restores issues', async () => {
    const { agent, project, lonely } = await setup('Checks Co');
    const profile = { name: '', maxBreakerByCrossSection: {}, powerFactor: 1, maxVoltageDropPct: 3, rcdRequiredCategories: ['Sockets'] };
    await agent.put(`/api/projects/${project.id}/electrical-profile`).send(profile).expect(200);
    await agent.put(`/api/projects/${project.id}/electrical-profile`).send({ ...profile, rcdRequiredCategories: ['Garden gnomes'] }).expect(400);
    await agent.post(`/api/projects/${project.id}/circuits`).send({ ...DEFAULT_CIRCUIT, category: 'Sockets', rcdGroup: null }).expect(201);

    let inst = (await agent.get(`/api/projects/${project.id}/installation`)).body as shared.InstallationDto;
    expect(inst.profile).toMatchObject({ maxVoltageDropPct: 3, rcdRequiredCategories: ['Sockets'] });
    const issues = runChecks(inst);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['D1', 'C1', 'C5', 'C9']));
    const d1 = issues.find((i) => i.code === 'D1' && i.componentIds[0] === lonely.id)!;

    await agent.post(`/api/projects/${project.id}/ignored-issues`).send({ issueId: d1.id }).expect(200);
    await agent.post(`/api/projects/${project.id}/ignored-issues`).send({ issueId: d1.id }).expect(200); // idempotent
    await agent.post(`/api/projects/${project.id}/ignored-issues`).send({ issueId: 'not an id' }).expect(400);
    inst = (await agent.get(`/api/projects/${project.id}/installation`)).body;
    expect(inst.ignoredIssues).toEqual([{ id: d1.id, ignoredBy: 'Test Electrician', ignoredAt: expect.any(String) }]);
    expect(applyIgnored(runChecks(inst), inst.ignoredIssues).open.map((i) => i.id)).not.toContain(d1.id);

    await agent.post(`/api/projects/${project.id}/ignored-issues/restore`).send({ issueId: d1.id }).expect(200);
    expect((await agent.get(`/api/projects/${project.id}/installation`)).body.ignoredIssues).toEqual([]);

    const other = await signUp('Checks Other Co');
    await other.agent.post(`/api/projects/${project.id}/ignored-issues`).send({ issueId: d1.id }).expect(404);
  });

  it('adds a Checks section to the PDF when asked', async () => {
    const { agent, project } = await setup('Checks PDF Co');
    const res = await binary(agent.post(`/api/projects/${project.id}/exports`).send({ ...DEFAULT_EXPORT_OPTIONS, sections: ['checks'] })).expect(200);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(res.body as Buffer), verbosity: 0 }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(text).toContain('Checks (open issues)');
    expect(text).toContain('Component without a wire');
    expect(DEFAULT_EXPORT_OPTIONS.sections).not.toContain('checks');
  });

  it('exports one floor as DXF or all floors as a ZIP, also while read-only, never for other companies', async () => {
    const { agent, project, floor } = await setup('DXF Co');
    await agent.post(`/api/projects/${project.id}/floors`).send({ name: 'Kati i parë' }).expect(201);
    const one = await binary(agent.get(`/api/projects/${project.id}/dxf?floorId=${floor.id}`)).expect(200);
    expect(one.headers['content-type']).toContain('application/dxf');
    expect(one.headers['content-disposition']).toContain('ground-floor.dxf');
    const text = (one.body as Buffer).toString('utf8');
    expect(text).toContain('AC1009');
    expect(text.match(/\r\nINSERT\r\n/g)).toHaveLength(2);

    const all = await binary(agent.get(`/api/projects/${project.id}/dxf`)).expect(200);
    expect(all.headers['content-type']).toContain('application/zip');
    const z = all.body as Buffer;
    expect(z.readUInt16LE(z.length - 12)).toBe(2);
    expect(z.toString('latin1')).toContain('02-kati-i-pare.dxf');

    const db = (await import('../src/prisma/prisma.service.js')).PrismaService;
    const orgId = (await agent.get('/api/auth/me')).body.organization.id;
    await app.get(db).organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    await binary(agent.get(`/api/projects/${project.id}/dxf?floorId=${floor.id}`)).expect(200);

    const other = await signUp('DXF Other Co');
    await other.agent.get(`/api/projects/${project.id}/dxf`).expect(404);
    await agent.get(`/api/projects/${project.id}/dxf?floorId=not-a-uuid`).expect(400);
  });
});

describe('team: invitations, roles, companies', () => {
  const tokenOf = (link: string) => link.split('/invite/')[1]!;
  async function invite(agent: ReturnType<typeof request.agent>, email: string, role: 'ADMIN' | 'MEMBER' = 'MEMBER') {
    return (await agent.post('/api/team/invitations').send({ email, role }).expect(201)).body as shared.CreatedInvitationDto;
  }

  it('invites a new person who signs up from the link and lands in the company', async () => {
    const owner = await signUp('Team Co');
    const client = (await owner.agent.post('/api/clients').send({ name: 'Shared client' }).expect(201)).body;
    const email = `new-${randomUUID()}@example.com`;
    const { link, invitation } = await invite(owner.agent, email, 'MEMBER');
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(invitation).toMatchObject({ email, role: 'MEMBER', invitedBy: 'Test Electrician' });

    const anon = request.agent(app.getHttpServer());
    const preview = (await anon.get(`/api/invitations/${tokenOf(link)}`).expect(200)).body;
    expect(preview).toMatchObject({ status: 'valid', organizationName: 'Team Co', role: 'MEMBER', email, accountExists: false });

    await anon.post(`/api/invitations/${tokenOf(link)}/sign-up`).send({ name: 'New Electrician', password: 'short' }).expect(400);
    const session = (await anon.post(`/api/invitations/${tokenOf(link)}/sign-up`).send({ name: 'New Electrician', password: 'correct horse battery' }).expect(201)).body;
    expect(session.organization).toMatchObject({ name: 'Team Co', role: 'MEMBER' });
    // shares the company's data
    expect((await anon.get('/api/clients').expect(200)).body.map((c: { id: string }) => c.id)).toContain(client.id);
    // members cannot manage the team or prices
    await anon.post('/api/team/invitations').send({ email: 'x@example.com', role: 'MEMBER' }).expect(403);
    await anon.post('/api/materials').send({ code: null, name: 'X', unit: 'pcs', unitPrice: 1, packSize: null, category: null, archived: false }).expect(403);
    const team = (await anon.get('/api/team').expect(200)).body;
    expect(team.members).toHaveLength(2);
    expect(team.invitations).toEqual([]); // hidden from members

    // the link works once
    expect((await anon.get(`/api/invitations/${tokenOf(link)}`)).body.status).toBe('used');
    await request(app.getHttpServer()).post(`/api/invitations/${tokenOf(link)}/sign-up`).send({ name: 'X', password: 'correct horse battery' }).expect(410);
  });

  it('lets an existing user join only with their own email and switch between companies', async () => {
    const owner = await signUp('Join Co');
    const other = await signUp('Own Co');
    const wrong = await signUp('Someone Else Co');

    const { link } = await invite(owner.agent, other.email.toUpperCase(), 'ADMIN');
    expect((await request(app.getHttpServer()).get(`/api/invitations/${tokenOf(link)}`)).body.accountExists).toBe(true);
    await wrong.agent.post(`/api/invitations/${tokenOf(link)}/accept`).expect(403);
    await request(app.getHttpServer()).post(`/api/invitations/${tokenOf(link)}/sign-up`).send({ name: 'X', password: 'correct horse battery' }).expect(409);

    const joined = (await other.agent.post(`/api/invitations/${tokenOf(link)}/accept`).expect(200)).body as shared.SessionDto;
    expect(joined.organization).toMatchObject({ name: 'Join Co', role: 'ADMIN' });
    expect(joined.organizations.map((o) => o.name)).toEqual(['Join Co', 'Own Co']);

    const own = joined.organizations.find((o) => o.name === 'Own Co')!;
    expect((await other.agent.post('/api/auth/switch').send({ organizationId: own.id }).expect(200)).body.organization.name).toBe('Own Co');
    const foreign = (await wrong.agent.get('/api/auth/me')).body.organization.id;
    await other.agent.post('/api/auth/switch').send({ organizationId: foreign }).expect(403);

    // sign-in opens the company used last
    const again = await request(app.getHttpServer()).post('/api/auth/sign-in').send({ email: other.email, password: 'correct horse battery' }).expect(200);
    expect(again.body.organization.name).toBe('Own Co');
  });

  it('enforces role rules, ownership transfer, removal and leaving', async () => {
    const owner = await signUp('Roles Co');
    const adminEmail = `admin-${randomUUID()}@example.com`;
    const memberEmail = `member-${randomUUID()}@example.com`;
    const admin = request.agent(app.getHttpServer());
    const member = request.agent(app.getHttpServer());
    const adminLink = (await invite(owner.agent, adminEmail, 'ADMIN')).link;
    const memberLink = (await invite(owner.agent, memberEmail, 'MEMBER')).link;
    await admin.post(`/api/invitations/${tokenOf(adminLink)}/sign-up`).send({ name: 'Admin', password: 'correct horse battery' }).expect(201);
    await member.post(`/api/invitations/${tokenOf(memberLink)}/sign-up`).send({ name: 'Member', password: 'correct horse battery' }).expect(201);
    const members = (await owner.agent.get('/api/team')).body.members as shared.MemberDto[];
    const ids = Object.fromEntries(members.map((m) => [m.name, m.userId]));
    const ownerId = (await owner.agent.get('/api/auth/me')).body.user.id;

    await admin.patch(`/api/team/members/${ownerId}`).send({ role: 'MEMBER' }).expect(403); // nobody manages the owner
    await admin.delete(`/api/team/members/${ownerId}`).expect(403);
    await member.delete(`/api/team/members/${ids['Admin']}`).expect(403);
    await admin.patch(`/api/team/members/${ids['Member']}`).send({ role: 'ADMIN' }).expect(204);
    await admin.patch(`/api/team/members/${ids['Admin']}`).send({ role: 'MEMBER' }).expect(400); // not yourself
    await owner.agent.patch(`/api/team/members/${ids['Member']}`).send({ role: 'OWNER' }).expect(400);

    await admin.post('/api/team/transfer-ownership').send({ userId: ids['Admin'] }).expect(403);
    await owner.agent.post('/api/team/transfer-ownership').send({ userId: ids['Admin'] }).expect(204);
    expect((await admin.get('/api/auth/me')).body.organization.role).toBe('OWNER');
    expect((await owner.agent.get('/api/auth/me')).body.organization.role).toBe('ADMIN');
    await admin.post('/api/team/leave').expect(400); // the owner cannot leave

    // removing ends the member's session for this company at once
    await admin.delete(`/api/team/members/${ids['Member']}`).expect(200);
    await member.get('/api/clients').expect(401);
    const signIn = await request(app.getHttpServer()).post('/api/auth/sign-in').send({ email: memberEmail, password: 'correct horse battery' }).expect(403);
    expect(signIn.body.message).toMatch(/no longer belongs to any company/);

    await owner.agent.post('/api/team/leave').expect(204);
    await owner.agent.get('/api/clients').expect(401);
    expect(((await admin.get('/api/team')).body.members as unknown[]).length).toBe(1);
  });

  it('replaces and revokes invitations, keeps them private, and refuses invites while read-only', async () => {
    const owner = await signUp('Invites Co');
    const email = `x-${randomUUID()}@example.com`;
    const first = await invite(owner.agent, email);
    const second = await invite(owner.agent, email);
    expect((await request(app.getHttpServer()).get(`/api/invitations/${tokenOf(first.link)}`)).body.status).toBe('revoked');
    const team = (await owner.agent.get('/api/team')).body as shared.TeamDto;
    expect(team.invitations.map((i) => i.id)).toEqual([second.invitation.id]);

    const stranger = await signUp('Stranger Co');
    await stranger.agent.delete(`/api/team/invitations/${second.invitation.id}`).expect(404);
    await owner.agent.delete(`/api/team/invitations/${second.invitation.id}`).expect(204);
    expect((await request(app.getHttpServer()).get(`/api/invitations/${tokenOf(second.link)}`)).body.status).toBe('revoked');
    await request(app.getHttpServer()).get('/api/invitations/not-a-token').expect(400);
    await request(app.getHttpServer()).get(`/api/invitations/${'a'.repeat(43)}`).expect(404);
    const me = (await owner.agent.get('/api/auth/me')).body;
    await owner.agent.post('/api/team/invitations').send({ email: me.user.email, role: 'MEMBER' }).expect(409);

    const { PrismaService } = await import('../src/prisma/prisma.service.js');
    await app.get(PrismaService).organization.update({ where: { id: me.organization.id }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    await owner.agent.post('/api/team/invitations').send({ email: `y-${randomUUID()}@example.com`, role: 'MEMBER' }).expect(402);
  });

  it('keeps subscription seats equal to the number of members', async () => {
    const owner = await signUp('Seats Co');
    const { url } = (await owner.agent.post('/api/billing/checkout').send({ interval: 'month' }).expect(200)).body;
    await owner.agent.post('/api/billing/dev/complete').send({ token: new URL(url).searchParams.get('dev-checkout') }).expect(200);
    expect((await owner.agent.get('/api/billing')).body.seats).toBe(1);

    const guest = request.agent(app.getHttpServer());
    const { link } = await invite(owner.agent, `seat-${randomUUID()}@example.com`);
    await guest.post(`/api/invitations/${tokenOf(link)}/sign-up`).send({ name: 'Seat Two', password: 'correct horse battery' }).expect(201);
    expect((await owner.agent.get('/api/billing')).body).toMatchObject({ seats: 2, members: 2 });

    const guestId = (await guest.get('/api/auth/me')).body.user.id;
    expect((await owner.agent.delete(`/api/team/members/${guestId}`).expect(200)).body).toEqual({ seatsError: null });
    expect((await owner.agent.get('/api/billing')).body).toMatchObject({ seats: 1, members: 1 });
  });
});
