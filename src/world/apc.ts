import * as THREE from 'three';
import type { Sim } from 'wasm-sim';
import {
  APC_HOVER_HEIGHT,
  APC_HULL_LENGTH,
  APC_HULL_WIDTH,
  APC_ORIENTATION_SLERP_RATE,
  GROUND_SIZE,
} from '../sim/config';
import { DEFAULT_APC_SUPPORT_LAYOUT, type SupportLayout } from './apcSupport';

type SupportPoint = { x: number; y: number; z: number };

type FitPlaneResult = {
  centroid: THREE.Vector3;
  up: THREE.Vector3;
};

type ApcVisualState = {
  initialized: boolean;
  previousX: number;
  previousZ: number;
  headingOnXZ: THREE.Vector3;
  forward: THREE.Vector3;
};

const APC_HULL_THICKNESS = 0.16;
const STATIONARY_EPSILON = 1e-6;
const PLANE_EPSILON = 1e-8;
const MAX_DIRECTION_STEP_SQ = (GROUND_SIZE * 0.5) ** 2;

const meshState = new WeakMap<THREE.Mesh, ApcVisualState>();

const tempMovement = new THREE.Vector3();
const tempProjected = new THREE.Vector3();
const tempRight = new THREE.Vector3();
const tempSmoothedUp = new THREE.Vector3();
const tempTargetQuat = new THREE.Quaternion();
const tempBasis = new THREE.Matrix4();

function getOrCreateState(mesh: THREE.Mesh, sim: Sim): ApcVisualState {
  const existing = meshState.get(mesh);
  if (existing) return existing;

  const state: ApcVisualState = {
    initialized: false,
    previousX: sim.apc_x(),
    previousZ: sim.apc_z(),
    headingOnXZ: new THREE.Vector3(0, 0, 1),
    forward: new THREE.Vector3(0, 0, 1),
  };
  meshState.set(mesh, state);
  return state;
}

function projectOntoPlane(v: THREE.Vector3, up: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const d = v.dot(up);
  return out.copy(v).addScaledVector(up, -d);
}

function resolveSupportPoints(
  sim: Sim,
  layout: SupportLayout,
  centerX: number,
  centerZ: number,
  headingOnXZ: THREE.Vector3,
): SupportPoint[] {
  const points: SupportPoint[] = [];
  const heightMult = sim.height_mult();
  const forwardX = headingOnXZ.x;
  const forwardZ = headingOnXZ.z;
  const rightX = forwardZ;
  const rightZ = -forwardX;

  const resolveAt = (localX: number, localZ: number): SupportPoint => {
    const worldX = centerX + localX * rightX + localZ * forwardX;
    const worldZ = centerZ + localX * rightZ + localZ * forwardZ;
    const worldY = sim.sample_height(worldX, worldZ) * heightMult;
    return { x: worldX, y: worldY, z: worldZ };
  };

  for (const slot of layout) {
    if (slot.kind === 'wheel') {
      points.push(resolveAt(slot.localX, slot.localZ));
      continue;
    }

    const sampleCount = Math.max(1, Math.floor(slot.sampleCount));
    const treadStart = slot.localZ - slot.length * 0.5;
    const step = sampleCount > 1 ? slot.length / (sampleCount - 1) : 0;

    let sumY = 0;
    let anchor: SupportPoint | null = null;
    for (let i = 0; i < sampleCount; i++) {
      const sampleLocalZ = treadStart + i * step;
      const sample = resolveAt(slot.localX, sampleLocalZ);
      if (!anchor) anchor = sample;
      sumY += sample.y;
    }

    if (!anchor) {
      throw new Error('Support resolution error: tread slot failed to produce any sample.');
    }

    points.push({
      x: anchor.x,
      z: anchor.z,
      y: sumY / sampleCount,
    });
  }

  return points;
}

function jacobiEigenSymmetric3x3(
  c00: number,
  c01: number,
  c02: number,
  c11: number,
  c12: number,
  c22: number,
): { eigenvalues: [number, number, number]; eigenvectors: number[][] } {
  const a = [
    [c00, c01, c02],
    [c01, c11, c12],
    [c02, c12, c22],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iter = 0; iter < 12; iter++) {
    let p = 0;
    let q = 1;
    let max = Math.abs(a[0][1]);
    const a02 = Math.abs(a[0][2]);
    const a12 = Math.abs(a[1][2]);
    if (a02 > max) {
      max = a02;
      p = 0;
      q = 2;
    }
    if (a12 > max) {
      max = a12;
      p = 1;
      q = 2;
    }
    if (max < 1e-12) break;

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    if (Math.abs(apq) < 1e-12) continue;

    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    a[p][p] = app - t * apq;
    a[q][q] = aqq + t * apq;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let k = 0; k < 3; k++) {
      if (k === p || k === q) continue;
      const akp = a[k][p];
      const akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[p][k] = a[k][p];
      a[k][q] = s * akp + c * akq;
      a[q][k] = a[k][q];
    }

    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p];
      const vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }

  return {
    eigenvalues: [a[0][0], a[1][1], a[2][2]],
    eigenvectors: v,
  };
}

function fitPlane(points: SupportPoint[]): FitPlaneResult {
  if (points.length < 3) {
    throw new Error(`Support layout error: need at least 3 support points, got ${points.length}.`);
  }

  const centroid = new THREE.Vector3(0, 0, 0);
  for (const p of points) centroid.add(new THREE.Vector3(p.x, p.y, p.z));
  centroid.multiplyScalar(1 / points.length);

  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;

  for (const p of points) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dz = p.z - centroid.z;
    c00 += dx * dx;
    c01 += dx * dy;
    c02 += dx * dz;
    c11 += dy * dy;
    c12 += dy * dz;
    c22 += dz * dz;
  }

  const invCount = 1 / points.length;
  c00 *= invCount;
  c01 *= invCount;
  c02 *= invCount;
  c11 *= invCount;
  c12 *= invCount;
  c22 *= invCount;

  const trace = c00 + c11 + c22;
  if (!Number.isFinite(trace) || trace < PLANE_EPSILON) {
    throw new Error('Support layout error: covariance is near-singular; points may be coincident.');
  }

  const eig = jacobiEigenSymmetric3x3(c00, c01, c02, c11, c12, c22);
  const ranked = [
    { index: 0, value: eig.eigenvalues[0] },
    { index: 1, value: eig.eigenvalues[1] },
    { index: 2, value: eig.eigenvalues[2] },
  ].sort((a, b) => a.value - b.value);

  const secondSmallest = ranked[1].value;
  if (!Number.isFinite(secondSmallest) || secondSmallest < trace * 1e-6) {
    throw new Error('Support layout error: support points are collinear or degenerate for plane fitting.');
  }

  const normalIndex = ranked[0].index;
  const up = new THREE.Vector3(
    eig.eigenvectors[0][normalIndex],
    eig.eigenvectors[1][normalIndex],
    eig.eigenvectors[2][normalIndex],
  );

  const upLenSq = up.lengthSq();
  if (!Number.isFinite(upLenSq) || upLenSq < PLANE_EPSILON) {
    throw new Error('Support layout error: fitted normal is invalid or near zero.');
  }
  up.normalize();
  if (up.y < 0) up.multiplyScalar(-1);

  return { centroid, up };
}

function computeHeadingDirection(
  state: ApcVisualState,
  centerX: number,
  centerZ: number,
  targetX: number,
  targetZ: number,
): void {
  tempMovement.set(centerX - state.previousX, 0, centerZ - state.previousZ);
  const stepSq = tempMovement.lengthSq();

  state.previousX = centerX;
  state.previousZ = centerZ;

  if (stepSq > STATIONARY_EPSILON && stepSq < MAX_DIRECTION_STEP_SQ) {
    state.headingOnXZ.copy(tempMovement.normalize());
    return;
  }

  tempMovement.set(targetX - centerX, 0, targetZ - centerZ);
  if (tempMovement.lengthSq() > STATIONARY_EPSILON) {
    state.headingOnXZ.copy(tempMovement.normalize());
  }
}

export function createApcMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(APC_HULL_WIDTH, APC_HULL_THICKNESS, APC_HULL_LENGTH),
    new THREE.MeshStandardMaterial({ color: 0xff8844 })
  );

  const noseIndicator = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, APC_HULL_THICKNESS * 0.55, APC_HULL_LENGTH * 0.48),
    APC_HULL_LENGTH * 0.28,
    0x33dd66,
    APC_HULL_LENGTH * 0.12,
    APC_HULL_LENGTH * 0.08,
  );
  mesh.add(noseIndicator);
  return mesh;
}

export function syncApcMesh(mesh: THREE.Mesh, sim: Sim, deltaSeconds: number): void {
  const state = getOrCreateState(mesh, sim);
  const centerX = sim.apc_x();
  const centerZ = sim.apc_z();

  computeHeadingDirection(state, centerX, centerZ, sim.apc_target_x(), sim.apc_target_z());

  try {
    const supportPoints = resolveSupportPoints(
      sim,
      DEFAULT_APC_SUPPORT_LAYOUT,
      centerX,
      centerZ,
      state.headingOnXZ,
    );
    const fit = fitPlane(supportPoints);

    projectOntoPlane(state.headingOnXZ, fit.up, tempProjected);
    if (tempProjected.lengthSq() <= STATIONARY_EPSILON) {
      projectOntoPlane(state.forward, fit.up, tempProjected);
    }
    if (tempProjected.lengthSq() <= STATIONARY_EPSILON) {
      tempProjected.set(0, 0, 1);
      projectOntoPlane(tempProjected, fit.up, tempProjected);
    }
    if (tempProjected.lengthSq() <= STATIONARY_EPSILON) {
      tempProjected.set(1, 0, 0);
      projectOntoPlane(tempProjected, fit.up, tempProjected);
    }
    tempProjected.normalize();

    tempRight.crossVectors(fit.up, tempProjected);
    if (tempRight.lengthSq() <= STATIONARY_EPSILON) {
      throw new Error('APC orientation error: forward/up cross product degenerated to zero.');
    }
    tempRight.normalize();
    tempProjected.crossVectors(tempRight, fit.up).normalize();

    tempBasis.makeBasis(tempRight, fit.up, tempProjected);
    tempTargetQuat.setFromRotationMatrix(tempBasis);

    const safeDelta = Math.max(0, deltaSeconds);
    const slerpAlpha = 1 - Math.exp(-APC_ORIENTATION_SLERP_RATE * safeDelta);
    if (!state.initialized) {
      mesh.quaternion.copy(tempTargetQuat);
      state.initialized = true;
    } else {
      mesh.quaternion.slerp(tempTargetQuat, slerpAlpha);
    }

    state.forward.set(0, 0, 1).applyQuaternion(mesh.quaternion).normalize();
    tempSmoothedUp.set(0, 1, 0).applyQuaternion(mesh.quaternion).normalize();

    mesh.position.copy(fit.centroid).addScaledVector(tempSmoothedUp, APC_HOVER_HEIGHT);
  } catch (error) {
    console.error('[apc] support-plane solve failed', error);
  }
}
