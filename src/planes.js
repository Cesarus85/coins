import * as THREE from 'https://unpkg.com/three@0.166.1/build/three.module.js';

export class PlaneTracker {
  constructor() {
    this.planes = new Map();   // XRPlane -> { lastChangedTime, mesh }
    this.debugGroup = new THREE.Group();
    this._debugEnabled = false;
  }

  setDebug(enabled, scene) {
    this._debugEnabled = enabled;
    if (enabled) {
      if (!this.debugGroup.parent && scene) scene.add(this.debugGroup);
    } else {
      this.debugGroup.removeFromParent();
      this.debugGroup.clear();
    }
  }

  update(frame, refSpace, scene) {
    let detected = 0;
    try {
      const detectedPlanes = frame.detectedPlanes;
      detected = detectedPlanes?.size ?? 0;

      // Remove gone planes
      for (const [plane] of this.planes) {
        if (!detectedPlanes.has(plane)) {
          const item = this.planes.get(plane);
          if (item?.mesh) item.mesh.removeFromParent();
          this.planes.delete(plane);
        }
      }

      // Add/update current planes
      detectedPlanes?.forEach(plane => {
        const last = this.planes.get(plane)?.lastChangedTime ?? -1;
        if (!this.planes.has(plane) || plane.lastChangedTime > last) {
          if (this._debugEnabled && scene) {
            const mesh = this._buildDebugMesh(plane, frame, refSpace);
            const prev = this.planes.get(plane)?.mesh;
            if (prev) prev.removeFromParent();
            if (mesh) this.debugGroup.add(mesh);
            this.planes.set(plane, { lastChangedTime: plane.lastChangedTime, mesh, plane });
          } else {
            this.planes.set(plane, { lastChangedTime: plane.lastChangedTime, mesh: null, plane });
          }
        }
      });
    } catch {
      // Plane API evtl. nicht verfügbar
    }
    return detected;
  }

  _buildDebugMesh(plane, frame, refSpace) {
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose) return null;

    const poly = plane.polygon;
    const positions = [];
    const m = this._poseToMatrix(pose);
    const v = new THREE.Vector3();

    for (const p of poly) {
      v.set(p.x, p.y, p.z).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
    const color = plane.orientation === 'horizontal' ? 0x00ff88 : 0x4488ff;
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });
    return new THREE.LineLoop(geom, mat);
  }

  _poseToMatrix(pose) {
    const { position, orientation } = pose.transform;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
    m.compose(
      new THREE.Vector3(position.x, position.y, position.z),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    return m;
  }

  classify(frame, refSpace) {
    let floorPlane = null;
    const wallPlanes = [];
    let planeCount = 0;

    try {
      const detectedPlanes = frame.detectedPlanes;
      planeCount = detectedPlanes?.size ?? 0;
      if (!detectedPlanes || detectedPlanes.size === 0) return { floorPlane, wallPlanes, planeCount };

      let maxArea = 0;
      detectedPlanes.forEach(plane => {
        const area = polygonAreaXZ(plane.polygon);
        if (plane.orientation === 'horizontal') {
          if (area > maxArea) { maxArea = area; floorPlane = plane; }
        } else if (plane.orientation === 'vertical') {
          if (area > 0.1) wallPlanes.push(plane);
        }
      });
    } catch {
      // keine Plane API
    }
    return { floorPlane, wallPlanes, planeCount };
  }
}

function polygonAreaXZ(polygon) {
  if (!polygon || polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i], pj = polygon[j];
    area += (pj.x * pi.z - pi.x * pj.z);
  }
  return Math.abs(area * 0.5);
}

