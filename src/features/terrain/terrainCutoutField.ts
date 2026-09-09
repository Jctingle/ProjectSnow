import * as THREE from 'three';

export type TerrainCutoutField = {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  rotationY: number;
};

type CutoutUniforms = {
  count: { value: number };
  rects: { value: THREE.Vector4[] };
  rotations: { value: THREE.Vector2[] };
};

const MAX_CUTOUT_FIELDS = 8;
const CUTOUT_CACHE_KEY = 'terrain-cutout-field';

// Shard-local plane coordinates: the terrain plane is rotated -90deg about X,
// so geometry position.y maps to world -Z and position.z carries the height.
// Working in this space keeps the test independent of shard world offsets.
const VERTEX_VARYING = 'varying vec2 vTerrainFieldXZ;\n';
const VERTEX_ASSIGN = `#include <begin_vertex>
  vTerrainFieldXZ = vec2(position.x, -position.y);`;

const FRAGMENT_DECLARATIONS = `uniform int uCutoutCount;
uniform vec4 uCutoutRect[${MAX_CUTOUT_FIELDS}];
uniform vec2 uCutoutRot[${MAX_CUTOUT_FIELDS}];
varying vec2 vTerrainFieldXZ;
`;

const FRAGMENT_DISCARD = `void main() {
  for (int i = 0; i < ${MAX_CUTOUT_FIELDS}; i++) {
    if (i >= uCutoutCount) break;
    vec4 rect = uCutoutRect[i];
    vec2 rot = uCutoutRot[i];
    vec2 delta = vTerrainFieldXZ - rect.xy;
    vec2 local = vec2(
      delta.x * rot.x - delta.y * rot.y,
      delta.x * rot.y + delta.y * rot.x
    );
    if (abs(local.x) <= rect.z && abs(local.y) <= rect.w) discard;
  }`;

function terrainMaterialOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial | null {
  return mesh.material instanceof THREE.MeshStandardMaterial ? mesh.material : null;
}

function installCutoutHook(material: THREE.MeshStandardMaterial): CutoutUniforms {
  const uniforms: CutoutUniforms = {
    count: { value: 0 },
    rects: {
      value: Array.from({ length: MAX_CUTOUT_FIELDS }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    rotations: {
      value: Array.from({ length: MAX_CUTOUT_FIELDS }, () => new THREE.Vector2(1, 0)),
    },
  };

  material.userData.terrainCutoutUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCutoutCount = uniforms.count;
    shader.uniforms.uCutoutRect = uniforms.rects;
    shader.uniforms.uCutoutRot = uniforms.rotations;
    shader.vertexShader = VERTEX_VARYING + shader.vertexShader
      .replace('#include <begin_vertex>', VERTEX_ASSIGN);
    shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader
      .replace('void main() {', FRAGMENT_DISCARD);
  };
  material.customProgramCacheKey = () => CUTOUT_CACHE_KEY;
  material.needsUpdate = true;
  return uniforms;
}

/**
 * Hides the terrain surface inside each rotated footprint by discarding those
 * fragments in shard-local space, so no texture/UV remapping can offset them.
 */
export function applyTerrainCutoutFields(mesh: THREE.Mesh, fields: TerrainCutoutField[]): void {
  const material = terrainMaterialOf(mesh);
  if (!material) {
    return;
  }

  const existing = material.userData.terrainCutoutUniforms as CutoutUniforms | undefined;
  if (!existing && fields.length === 0) {
    return;
  }

  const uniforms = existing ?? installCutoutHook(material);
  const usable = Math.min(fields.length, MAX_CUTOUT_FIELDS);
  if (import.meta.env.DEV && fields.length > MAX_CUTOUT_FIELDS) {
    console.warn(
      `[terrain-cutout] ${fields.length} fields requested, capped at ${MAX_CUTOUT_FIELDS}.`,
    );
  }

  for (let index = 0; index < usable; index += 1) {
    const field = fields[index];
    uniforms.rects.value[index].set(field.x, field.z, field.halfWidth, field.halfDepth);
    uniforms.rotations.value[index].set(Math.cos(field.rotationY), Math.sin(field.rotationY));
  }
  uniforms.count.value = usable;
}
