# Electro House

Electrical installation planner for professional electricians: upload architectural floor plans (PDF),
organise them by client → project → floor, and plan the installation on top of them.

**Status:** Phase 1 (foundation) complete. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and roadmap.

## Stack

| Part | Tech |
|---|---|
| Web app | Angular 22 (standalone, Signals), PDF.js, SVG drawing layer — `apps/web` |
| API | NestJS 12, REST, Prisma 7, PostgreSQL — `apps/api` |
| Shared | Geometry, calibration maths, Zod validation schemas, DTO types — `packages/shared` |
| Files | S3-compatible storage (MinIO locally, R2/S3 in production); local disk for Docker-free development |

## Getting started

Requirements: Node 24+, npm 11+. Either Docker Desktop **or** nothing else (Prisma's local Postgres).

```bash
npm install
npm run build:shared
cp apps/api/.env.example apps/api/.env
```

**Database and file storage**, pick one:

- **With Docker:** `npm run db:up` (PostgreSQL + MinIO). Keep "Option A" in `apps/api/.env`.
- **Without Docker:** in `apps/api` run `npx prisma dev --name electro-house --detach`, then
  `npm run db:create-local -w @electro/api`, and switch `apps/api/.env` to "Option B".

Then create the tables and start both apps (two terminals):

```bash
npm run db:migrate -w @electro/api
npm run dev:api        # http://localhost:3000/api
npm run dev:web        # http://localhost:4200 (proxies /api to the API)
```

Open http://localhost:4200 and create an account.

## Tests

```bash
npm test                                   # shared + api unit + web unit tests
npm run test:e2e -w @electro/api           # API end-to-end tests (needs the database running)
npm run build                              # production build of everything
```

## Repository layout

```
apps/web        Angular app (features: auth, clients, projects, editor)
apps/api        NestJS API (modules: auth, clients, projects, floors, files, storage)
packages/shared Code used by both: geometry, calibration, schemas, DTOs
docs/           Architecture and roadmap
```
