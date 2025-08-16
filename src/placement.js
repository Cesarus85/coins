import * as THREE from 'https://unpkg.com/three@0.166.1/build/three.module.js';

export function choosePlacements(frame, refSpace, floorPlane, wallPlanes, opts = {}) {
  const { floorCount = 24, wallCountPerPlane = 6, minSpacing = 0.35 } = opts;
  const placements = [];
  const chosen = [];

  if (floorPlane) {
    const floorPose = frame.getPose(floorPlane.planeSpace, refSpace);
    sampleOnPlane(frame, refSpace, floorPlane, floorCount, minSpacing, chosen, placements, floorPose, 'floor');
  }

  for (const wp of wallPlanes) {
    const wallPose = frame.getPose(wp.planeSpace, refSpace);
    sampleOnPlane(frame, refSpace, wp, wallCountPerPlane, minSpacing, chosen, placements, wallPose, 'wall');
  }

  return placements;
}

function sampleOnPlane(frame, refSpace, plane, count, minSpacing, chosen, out, pose, kind) {
  const poly = plane.polygon;
  if (!poly?.length || !pose) return;

  // Plane-space Bounding-Box (XZ) + Matrix nach Welt
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.z > maxZ) maxZ = p.z;
  }

  const m = poseToMatrix(pose);
  const world = new THREE.Vector3();

  // Welt-Normale der Plane (Y-Achse im Plane-Space → Welt)
  const normal = new THREE.Vector3(0,1,0).applyQuaternion(matrixToQuaternion(m)).normalize();

  let attempts = 0, placed = 0;
  while (placed < count && attempts < count * 40) {
    attempts++;
    const x = randRange(minX, maxX);
    const z = randRange(minZ, maxZ);
    if (!pointInPolygonXZ(poly, x, z)) continue;

    world.set(x, 0, z).applyMatrix4(m);
    if (tooClose(world, chosen, minSpacing)) continue;

    chosen.push(world.clone());
    out.push({
      pose: { position: world.clone(), orientation: matrixToQuaternion(m) },
      kind,
      normal: normal.clone()
    });
    placed++;
  }
}

function randRange(a, b) { return a + Math.random() * (b - a); }
function tooClose(p, list, minD) { return list.some(q => p.distanceTo(q) < minD); }

function pointInPolygonXZ(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    const intersect = ((zi > z) !== (zj > z)) &&
      (x < (xj - xi) * (z - zi) / (zj - zi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function poseToMatrix(pose) {
  const { position, orientation } = pose.transform;
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
    new THREE.Vector3(1,1,1)
  );
  return m;
}

function matrixToQuaternion(m) {
  const q = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return q;
}
