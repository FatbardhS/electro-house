import { componentType, type ComponentDto, type InstallationDto } from '@electro/shared';

export interface ComponentOption {
  id: string;
  label: string;
  floorId: string;
  floorName: string;
  component: ComponentDto;
}

/** All components of the project with a readable label, e.g. "MDB1 · Main distribution board · Ground floor". */
export function componentOptions(inst: InstallationDto, filter: (c: ComponentDto) => boolean = () => true): ComponentOption[] {
  return inst.floors.flatMap((f) =>
    f.components.filter(filter).map((c) => ({
      id: c.id,
      label: `${c.label ?? '—'} · ${componentType(c.typeKey)?.name ?? c.typeKey} · ${f.name}`,
      floorId: f.floorId,
      floorName: f.name,
      component: c,
    })),
  );
}

export function boardOptions(inst: InstallationDto): ComponentOption[] {
  return componentOptions(inst, (c) => c.typeKey.startsWith('board.')).map((o) => ({
    ...o,
    label: `${o.component.label ?? 'Board'} (${o.floorName})`,
  }));
}

export function componentName(inst: InstallationDto, id: string): string {
  return componentOptions(inst, (c) => c.id === id)[0]?.label ?? 'missing component';
}
