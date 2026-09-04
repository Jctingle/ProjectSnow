import * as THREE from 'three';
import { getApcInterior } from '../../../entityStore';
import type { InteriorHull } from './interiorMath';

const LABEL_CELL_PIXELS = 64;

export function buildInteriorLabelTexture(
  hull: InteriorHull,
  level: number,
): THREE.CanvasTexture | null {
  const interior = getApcInterior();
  const canvas = document.createElement('canvas');
  canvas.width = hull.w * LABEL_CELL_PIXELS;
  canvas.height = hull.d * LABEL_CELL_PIXELS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${Math.floor(LABEL_CELL_PIXELS * 0.28)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let z = 0; z < hull.d; z += 1) {
    for (let x = 0; x < hull.w; x += 1) {
      const px = x * LABEL_CELL_PIXELS;
      const py = z * LABEL_CELL_PIXELS;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, LABEL_CELL_PIXELS - 2, LABEL_CELL_PIXELS - 2);

      const index = interior.cell_index(x, level, z);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(
        String(index),
        px + LABEL_CELL_PIXELS * 0.5,
        py + LABEL_CELL_PIXELS * 0.5,
      );
      ctx.fillStyle = 'rgba(150,200,255,0.8)';
      ctx.fillText(
        `${x},${level},${z}`,
        px + LABEL_CELL_PIXELS * 0.5,
        py + LABEL_CELL_PIXELS * 0.78,
      );
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
