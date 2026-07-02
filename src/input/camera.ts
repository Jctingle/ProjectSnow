import * as THREE from 'three';

const MIN_VIEW_SIZE = 5;
const MAX_VIEW_SIZE = 20;
const ZOOM_SENSITIVITY = 0.001;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function initCameraControls(
  camera: THREE.OrthographicCamera,
  renderer: HTMLCanvasElement,
): void {
  let isPanning = false;
  let lastX = 0;
  let lastY = 0;

  renderer.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    isPanning = true;
    lastX = event.clientX;
    lastY = event.clientY;
  });

  window.addEventListener('mousemove', (event: MouseEvent) => {
    if (!isPanning) {
      return;
    }

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    const worldPerPixelX = (camera.right - camera.left) / renderer.clientWidth;
    const worldPerPixelY = (camera.top - camera.bottom) / renderer.clientHeight;

    camera.position.x -= dx * worldPerPixelX;
    camera.position.z += dy * worldPerPixelY;
    camera.updateMatrixWorld();
  });

  const endPan = (): void => {
    isPanning = false;
  };

  window.addEventListener('mouseup', endPan);
  renderer.addEventListener('mouseleave', endPan);

  renderer.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      event.preventDefault();

      const aspect = renderer.clientWidth / renderer.clientHeight;
      const currentViewSize = camera.top - camera.bottom;
      const scaledViewSize = currentViewSize * Math.exp(event.deltaY * ZOOM_SENSITIVITY);
      const nextViewSize = clamp(scaledViewSize, MIN_VIEW_SIZE, MAX_VIEW_SIZE);

      camera.top = nextViewSize * 0.5;
      camera.bottom = -nextViewSize * 0.5;
      camera.right = nextViewSize * aspect * 0.5;
      camera.left = -nextViewSize * aspect * 0.5;
      camera.updateProjectionMatrix();
    },
    { passive: false },
  );
}