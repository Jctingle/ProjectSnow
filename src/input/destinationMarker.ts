import * as THREE from 'three';
import { getSim } from '../entityStore';

const SAMPLES_PER_SEGMENT = 12;
const STEM_HEIGHT = 1.5;
const LINE_Y_NUDGE = 0.3;

type DebugMarkerState = {
  pins: THREE.Mesh[];
  stems: THREE.Line[];
  staticLines: THREE.Line[];
  dynamicLine: THREE.Line | null;
  queue: { x: number; z: number }[];
};

export type DestinationMarkerController = {
  rebuild(queue: { x: number; z: number }[], apcWorldY: number): void;
  clear(): void;
  shiftBy(dx: number, dz: number, queue: { x: number; z: number }[], apcWorldY: number): void;
  updateDynamicLine(): void;
};

type MarkerOptions = {
  color: number;
};

function createMarkerController(
  scene: THREE.Scene,
  options: MarkerOptions,
): DestinationMarkerController {
  let debugMarkerState: DebugMarkerState = {
    pins: [],
    stems: [],
    staticLines: [],
    dynamicLine: null,
    queue: [],
  };

  const disposeObject = (object: THREE.Object3D): void => {
    scene.remove(object);
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) {
        for (const entry of material) entry.dispose();
      } else {
        material.dispose();
      }
    }
  };

  const disposeLine = (line: THREE.Line): void => {
    disposeObject(line);
  };

  const clear = (): void => {
    for (const pin of debugMarkerState.pins) disposeObject(pin);
    for (const stem of debugMarkerState.stems) disposeLine(stem);
    for (const line of debugMarkerState.staticLines) disposeLine(line);
    if (debugMarkerState.dynamicLine) disposeLine(debugMarkerState.dynamicLine);
    debugMarkerState = { pins: [], stems: [], staticLines: [], dynamicLine: null, queue: [] };
  };

  // Samples SAMPLES_PER_SEGMENT intermediate terrain heights along XZ to
  // produce a polyline that follows ground contour instead of cutting through it.
  const terrainLineGeometry = (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    heightAt: (x: number, z: number) => number,
  ): THREE.BufferGeometry => {
    const total = SAMPLES_PER_SEGMENT + 2;
    const positions = new Float32Array(total * 3);
    positions[0] = x0; positions[1] = y0; positions[2] = z0;
    for (let i = 1; i <= SAMPLES_PER_SEGMENT; i++) {
      const t = i / (SAMPLES_PER_SEGMENT + 1);
      const x = x0 + t * (x1 - x0);
      const z = z0 + t * (z1 - z0);
      positions[i * 3] = x;
      positions[i * 3 + 1] = heightAt(x, z);
      positions[i * 3 + 2] = z;
    }
    positions[(total - 1) * 3] = x1;
    positions[(total - 1) * 3 + 1] = y1;
    positions[(total - 1) * 3 + 2] = z1;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  };

  const rebuild = (queue: { x: number; z: number }[], apcWorldY: number): void => {
    clear();
    debugMarkerState.queue = queue.map(({ x, z }) => ({ x, z }));
    const sim = getSim();
    const pinY = (x: number, z: number): number =>
      sim.height_at_or_sample(x, z) * sim.height_mult() + LINE_Y_NUDGE;
    const heightAt = (x: number, z: number): number =>
      sim.height_at_or_sample(x, z) * sim.height_mult() + LINE_Y_NUDGE;
    const lineMat = (): THREE.LineBasicMaterial =>
      new THREE.LineBasicMaterial({ color: options.color });

    for (const waypoint of debugMarkerState.queue) {
      const y = pinY(waypoint.x, waypoint.z);

      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.08),
        new THREE.MeshBasicMaterial({ color: options.color }),
      );
      pin.position.set(waypoint.x, y, waypoint.z);
      scene.add(pin);
      debugMarkerState.pins.push(pin);

      const stemGeo = new THREE.BufferGeometry();
      stemGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([
          waypoint.x, y, waypoint.z,
          waypoint.x, y + STEM_HEIGHT, waypoint.z,
        ], 3),
      );
      const stem = new THREE.Line(stemGeo, lineMat());
      scene.add(stem);
      debugMarkerState.stems.push(stem);
    }

    for (let i = 1; i < debugMarkerState.queue.length; i++) {
      const from = debugMarkerState.queue[i - 1];
      const to = debugMarkerState.queue[i];
      const line = new THREE.Line(
        terrainLineGeometry(
          from.x, pinY(from.x, from.z), from.z,
          to.x, pinY(to.x, to.z), to.z,
          heightAt,
        ),
        lineMat(),
      );
      scene.add(line);
      debugMarkerState.staticLines.push(line);
    }

    if (debugMarkerState.queue.length > 0) {
      const first = debugMarkerState.queue[0];
      const dynamicLine = new THREE.Line(
        terrainLineGeometry(
          sim.apc_x(), apcWorldY, sim.apc_z(),
          first.x, pinY(first.x, first.z), first.z,
          heightAt,
        ),
        lineMat(),
      );
      scene.add(dynamicLine);
      debugMarkerState.dynamicLine = dynamicLine;
    }
  };

  const shiftBy = (
    _dx: number,
    _dz: number,
    queue: { x: number; z: number }[],
    apcWorldY: number,
  ): void => {
    rebuild(queue, apcWorldY);
  };

  const updateDynamicLine = (): void => {
    const line = debugMarkerState.dynamicLine;
    const first = debugMarkerState.queue[0];
    if (!line || !first) return;

    const sim = getSim();
    const x0 = sim.apc_x(), z0 = sim.apc_z(), y0 = sim.apc_y();
    const x1 = first.x, z1 = first.z;
    const y1 = sim.height_at_or_sample(x1, z1) * sim.height_mult() + LINE_Y_NUDGE;
    const total = SAMPLES_PER_SEGMENT + 2;

    const position = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    position.setXYZ(0, x0, y0, z0);
    for (let i = 1; i <= SAMPLES_PER_SEGMENT; i++) {
      const t = i / (SAMPLES_PER_SEGMENT + 1);
      const x = x0 + t * (x1 - x0);
      const z = z0 + t * (z1 - z0);
      position.setXYZ(i, x, sim.height_at_or_sample(x, z) * sim.height_mult() + LINE_Y_NUDGE, z);
    }
    position.setXYZ(total - 1, x1, y1, z1);
    position.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  };

  return {
    rebuild,
    clear,
    shiftBy,
    updateDynamicLine,
  };
}

export function createDestinationMarkerController(
  scene: THREE.Scene,
): DestinationMarkerController {
  return createMarkerController(scene, { color: 0xff0000 });
}

export function createSortieMarkerController(
  scene: THREE.Scene,
): DestinationMarkerController {
  return createMarkerController(scene, { color: 0x1ecf5b });
}
