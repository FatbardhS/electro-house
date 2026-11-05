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
