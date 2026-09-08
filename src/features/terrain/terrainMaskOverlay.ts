import * as THREE from 'three';
import { GROUND_SIZE } from '../../sim/config';

export type TerrainMaskSpec = {
  x: number;
  z: number;
  radius: number;
  seed: number;
  tint: string;
  opacity?: number;
  feather?: number;
};

const DEFAULT_TEXTURE_SIZE = 1024;
const DEFAULT_BASE_TERRAIN_COLOR = '#ffffff';

function normalizedFromWorld(value: number): number {
  return THREE.MathUtils.clamp(value / GROUND_SIZE + 0.5, 0, 1);
}

function pixelFromWorldX(x: number, textureSize: number): number {
  return normalizedFromWorld(x) * textureSize;
}

function pixelFromWorldZ(z: number, textureSize: number): number {
  return normalizedFromWorld(z) * textureSize;
}

function seededNoise(seed: number, x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 0.0731) * 43758.5453;
  return value - Math.floor(value);
}

function drawMaskBlob(
  ctx: CanvasRenderingContext2D,
  spec: TerrainMaskSpec,
  textureSize: number,
): void {
  const feather = spec.feather ?? 0.22;
  const opacity = spec.opacity ?? 0.86;
  const tint = new THREE.Color(spec.tint);
  const centerX = pixelFromWorldX(spec.x, textureSize);
  const centerY = pixelFromWorldZ(spec.z, textureSize);
  const radiusPx = Math.max(2, (spec.radius / GROUND_SIZE) * textureSize);
  const outerRadius = radiusPx * 1.18;

  const gradient = ctx.createRadialGradient(centerX, centerY, radiusPx * Math.max(0, 1 - feather), centerX, centerY, outerRadius);
  gradient.addColorStop(0, `rgba(${Math.round(tint.r * 255)}, ${Math.round(tint.g * 255)}, ${Math.round(tint.b * 255)}, ${opacity})`);
  gradient.addColorStop(0.7, `rgba(${Math.round(tint.r * 255)}, ${Math.round(tint.g * 255)}, ${Math.round(tint.b * 255)}, ${opacity * 0.55})`);
  gradient.addColorStop(1, `rgba(${Math.round(tint.r * 255)}, ${Math.round(tint.g * 255)}, ${Math.round(tint.b * 255)}, 0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
  ctx.fill();

  for (let blotch = 0; blotch < 22; blotch += 1) {
    const angle = seededNoise(spec.seed ^ blotch, blotch * 0.17, blotch * 0.23) * Math.PI * 2;
    const distance = seededNoise(spec.seed, blotch * 0.41, blotch * 0.13) * radiusPx * 0.72;
    const blotchRadius = radiusPx * (0.1 + seededNoise(spec.seed ^ 0x9e37, blotch * 0.09, blotch * 0.31) * 0.2);
    const alpha = opacity * (0.08 + seededNoise(spec.seed ^ 0x51ed, blotch * 0.29, blotch * 0.37) * 0.12);
    ctx.fillStyle = `rgba(${Math.round(tint.r * 255)}, ${Math.round(tint.g * 255)}, ${Math.round(tint.b * 255)}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(
      centerX + Math.cos(angle) * distance,
      centerY + Math.sin(angle) * distance,
      blotchRadius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function createTerrainMaskTexture(params: {
  masks: TerrainMaskSpec[];
  textureSize?: number;
  baseColor?: string;
}): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  const textureSize = params.textureSize ?? DEFAULT_TEXTURE_SIZE;
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = params.baseColor ?? DEFAULT_BASE_TERRAIN_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const spec of params.masks) {
    drawMaskBlob(ctx, spec, textureSize);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function terrainMaterialOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial | null {
  return mesh.material instanceof THREE.MeshStandardMaterial ? mesh.material : null;
}

export function applyTerrainMaskTexture(mesh: THREE.Mesh, params: {
  masks: TerrainMaskSpec[];
  textureSize?: number;
  baseColor?: string;
}): void {
  const material = terrainMaterialOf(mesh);
  if (!material) {
    return;
  }

  if (material.map) {
    material.map.dispose();
    material.map = null;
  }
  material.color.set(params.baseColor ?? DEFAULT_BASE_TERRAIN_COLOR);
  if (params.masks.length === 0) {
    material.needsUpdate = true;
    return;
  }

  const texture = createTerrainMaskTexture(params);
  if (!texture) {
    material.needsUpdate = true;
    return;
  }

  material.map = texture;
  material.needsUpdate = true;
}

export function disposeTerrainMaskTexture(mesh: THREE.Mesh): void {
  const material = terrainMaterialOf(mesh);
  if (!material) {
    return;
  }
  if (material.map) {
    material.map.dispose();
    material.map = null;
    material.needsUpdate = true;
  }
}
