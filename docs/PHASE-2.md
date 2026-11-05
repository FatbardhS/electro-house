# Phase 2: Electrical editor (design proposal)

Status: **proposal, waiting for approval.** Builds on Phase 1 (see ARCHITECTURE.md).

Goal: an electrician can pick real electrical symbols from a library, place them on a floor plan,
select / move / rotate / copy / delete them, edit their properties, organise them in layers,
and undo/redo everything. Every component is a structured object saved to the database.

## 1. Scope

**In Phase 2**
- Component catalog with recognizable symbols for the categories in the brief:
  lighting, outlets, switches, distribution/protection, communication/security, smart home, renewable/EV.
- Component library panel: categories, search, drag-and-drop onto the plan or click-to-place.
- Select tool: click, Shift+click, box selection, Ctrl+A; move by dragging, arrow keys to nudge.
- Rotate, delete, copy/paste, duplicate; copy selected components to another floor.
- Properties panel: label, layer, rotation, mounting height, description, and type-specific fields
  (e.g. power in W, number of gangs, IP rating). Multi-selection edits shared fields together.
- Layers per floor: lighting, outlets, switches, data/communication, smart home, distribution, annotations
  (and wiring, used in Phase 3). Show/hide and lock each layer.
- Grid snapping (toggle), undo/redo for every drawing change, autosave with the Phase 1 journal.

**Not in Phase 2:** wires and connections (Phase 3), circuits (Phase 4), creating custom
components in the UI (the data model allows it; the editor for it comes later), exports.

## 2. Component catalog (`packages/shared/src/catalog`)

Defined in code, so the API and the web app validate against the same list.

```ts
interface ComponentType {
  key: string;              // stable id, e.g. "outlet.double"; never reused
  version: number;          // bumped if the property schema changes
  category: Category;
  name: string;
  defaultLayer: LayerKey;
  symbol: { paths: SymbolPath[]; sizeMm: number }; // drawn around (0,0) in paper millimetres
  ports: PortDef[];         // connection points for Phase 3, defined now so symbols don't change later
  labelPrefix: string;      // "L", "S", "Q" … used for automatic labels (L1, L2, …)
  properties: ZodObject;    // type-specific fields and their validation
}
```

- **Symbols follow IEC 60617 conventions** (the European standard used on installation plans).
  If your market uses a national variant, the symbol data is the only thing that changes.
- **Symbol size is in paper millimetres** (typically 4–8 mm). Plan units are PDF points, so a symbol is
  the same size on the printed sheet at any drawing scale, like hand-drawn plans. It scales with zoom like the PDF.
- Rendering uses one SVG `<symbol>` per type and a `<use>` per placed component (fast with thousands).
- A legend page renders every symbol so they can be reviewed in one place.

## 3. Data model (new migration)

```prisma
model Layer {
  id        String  @id @default(uuid()) @db.Uuid
  floorId   String  @db.Uuid
  key       String            // "lighting", "outlets", … (fixed set in Phase 2)
  visible   Boolean @default(true)
  locked    Boolean @default(false)
  sortOrder Int
  @@unique([floorId, key])
}

model Component {
  id            String   @id @db.Uuid     // generated in the browser (UUID v7) so undo/redo/offline keep identity
  floorId       String   @db.Uuid
  typeKey       String
  typeVersion   Int
  layerKey      String
  label         String?                  // auto "S3", editable
  x             Float                    // plan coordinates (PDF points); zoom/pan/rotate never change them
  y             Float
  rotation      Float    @default(0)     // degrees
  mountHeightMm Int?
  description   String?
  properties    Json     @default("{}")  // validated by the type's schema on the server
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([floorId])
}
```

Layers are created for a floor on first use. Deleting a floor deletes its components (cascade).

## 4. API

- `GET /floors/:id/drawing` → `{ revision, layers, components }`
- `PATCH /floors/:id/drawing` → `{ baseRevision, ops: [...] }`, up to 500 ops, one transaction:
  - `{ op: 'upsert', component }`, `{ op: 'delete', id }`, `{ op: 'layer', key, visible?, locked? }`
  - Every component is validated: known type, position inside the page area, properties match the type's schema.
  - Returns the new revision. `409` if `baseRevision` is stale → the client reloads and re-applies its ops
    (ops are per object, so re-applying is safe; the last change to the same object wins).
- Same organization scoping and error format as Phase 1.

## 5. Editor architecture

- **DrawingStore** (Signals): components by id, layers, selection. Derived signals for visible/selectable
  components and the selection bounding box. No component data lives in the SVG; the SVG is drawn from the store.
- **Commands** for every change: `AddComponents`, `MoveComponents`, `RotateComponents`, `DeleteComponents`,
  `UpdateComponents`, `SetLayerState`. Each has `apply` and `invert` and produces the API ops.
- **History** per floor: undo/redo stacks (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y), kept while the editor is open.
  A drag is one command (not one per mouse move).
- **Autosave**: the Phase 1 FloorSync pattern generalised to drawing ops (journal → batch → revision check).
- **Hit-testing** by the SVG (pointer events on component groups); hidden or locked layers are not hit.
  Box selection uses plan-space bounding boxes.

### Keyboard
| Key | Action |
|---|---|
| V | Select tool (new default) |
| Esc | Cancel placement / clear selection |
| R / Shift+R | Rotate selection 90° / −90° (plan rotation moves to the toolbar buttons only) |
| Delete | Delete selection |
| Ctrl+C / Ctrl+V / Ctrl+D | Copy / paste at cursor / duplicate |
| Arrows | Nudge 1 mm on paper (Shift: 10 mm) |
| S | Toggle grid snapping (hold Alt while dragging to ignore it) |

## 6. Layout changes

- Left: tool rail + a 260 px panel with tabs **Library** and **Layers**.
- Right: properties of the selection (or floor/scale/measure info when nothing is selected).

## 7. Tests

- Commands: `invert(apply(state)) == state` for every command type, including multi-selection.
- History: undo/redo sequences, a drag producing one entry, redo cleared after a new change.
- Catalog: every type has a valid symbol, unique key, ports inside the symbol, and a property schema.
- API e2e: drawing ops saved and reloaded exactly, org scoping, 409 on stale revision, invalid type/properties rejected.
- Geometry: snapping, box selection, rotated symbol bounds.
- Performance check: 2,000 components on one floor stay responsive while panning and selecting.

## 8. Order of work
1. Catalog + symbols + legend page (review symbols early).
2. Migration, drawing API, e2e tests.
3. DrawingStore, commands, history, autosave + tests.
4. Library panel, placement, selection, move/rotate/delete/copy.
5. Properties panel, layers panel, snapping, copy to floor.
6. Browser check on the sample house plans, performance check, report.
