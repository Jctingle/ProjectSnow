import * as THREE from 'three';
import { getSim } from '../entityStore';

type DebugMarkerState = {
  pins: THREE.Mesh[];
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

export function createDestinationMarkerController(
  scene: THREE.Scene,
): DestinationMarkerController {
  let debugMarkerState: DebugMarkerState = {
    pins: [],
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
    for (const line of debugMarkerState.staticLines) disposeLine(line);
    if (debugMarkerState.dynamicLine) disposeLine(debugMarkerState.dynamicLine);
    debugMarkerState = { pins: [], staticLines: [], dynamicLine: null, queue: [] };
  };

  const lineGeometry = (from: THREE.Vector3, to: THREE.Vector3): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [from.x, from.y, from.z, to.x, to.y, to.z],
        3,
      ),
    );
    return geometry;
  };

  const rebuild = (queue: { x: number; z: number }[], apcWorldY: number): void => {
    clear();
    debugMarkerState.queue = queue.map(({ x, z }) => ({ x, z }));
    const sim = getSim();
    const pinY = (x: number, z: number): number =>
      sim.height_at_or_sample(x, z) * sim.height_mult() + 0.05;

    for (const waypoint of debugMarkerState.queue) {
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.08),
        new THREE.MeshBasicMaterial({ color: 0xff0000 }),
      );
      pin.position.set(waypoint.x, pinY(waypoint.x, waypoint.z), waypoint.z);
      scene.add(pin);
      debugMarkerState.pins.push(pin);
    }

    for (let i = 1; i < debugMarkerState.queue.length; i++) {
      const from = debugMarkerState.queue[i - 1];
      const to = debugMarkerState.queue[i];
      const line = new THREE.Line(
        lineGeometry(
          new THREE.Vector3(from.x, pinY(from.x, from.z), from.z),
          new THREE.Vector3(to.x, pinY(to.x, to.z), to.z),
        ),
        new THREE.LineBasicMaterial({ color: 0xff0000 }),
      );
      scene.add(line);
      debugMarkerState.staticLines.push(line);
    }

    if (debugMarkerState.queue.length > 0) {
      const first = debugMarkerState.queue[0];
      const dynamicLine = new THREE.Line(
        lineGeometry(
          new THREE.Vector3(sim.apc_x(), apcWorldY, sim.apc_z()),
          new THREE.Vector3(first.x, pinY(first.x, first.z), first.z),
        ),
        new THREE.LineBasicMaterial({ color: 0xff0000 }),
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
    const position = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    position.setXYZ(0, sim.apc_x(), sim.apc_y(), sim.apc_z());
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
