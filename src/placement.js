const THREE_URL = 'https://unpkg.com/three@0.166.1/build/three.module.js';
const { Vector3, Quaternion, Matrix4 } = await import(THREE_URL);

// Wählt plausible Coin-Posen auf Boden & Wänden, inklusive Min-Abstand.
export function choosePlacements(frame, refSpace, floorPlane, wallPlanes, opts = {}) {
  const { floorCount = 24, wallCountPerPlane = 6, minSpacing = 0.35 } = opts;
  const placements = [];
  const chosen = [];

  if (floorPlane) {
    const floorPose = frame.getPose(floorPlane.planeSpace, refSpace);
    sampleOnPlane(frame, refSpace, floorPlane, floorCount, minSpacing, chosen, placements, floorPose);
  }

  for (const wp of wallPlanes) {
    const wallPose = frame.getPose(wp.planeSpace, refSpace);
    sampleOnPlane(frame, refSpace, wp, wallCountPerPlane, minSpacing, chosen, placements, wallPose);
  }

  return placements;
}

function sampleOnPlane(frame, refSpace, plane, count, minSpacing, chosen, out, pose) {
  const poly = plane.polygon;
  if (!poly?.length || !pose) return;

  // Bounding box in plane-space (XZ)
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.z > maxZ) maxZ = p.z;
  }

  const m = poseToMatrix(pose);
  const world = new Vector3();

  let attempts = 0, placed = 0;
  while (placed < count && attempts < count * 40) {
    attempts++;

    const x = randRange(minX, maxX);
    const z = randRange(minZ, maxZ);
    const inside = pointInPolygonXZ(poly, x, z);
    if (!inside) continue;

    // plane-space → world
    world.set(x, 0, z).applyMatrix4(m);

    // Min-Abstand prüfen
    if (tooClose(world, chosen, minSpacing)) continue;

    chosen.push(world.clone());
    out.push({ pose: { position: world.clone(), orientation: matrixToQuaternion(m) } });
    placed++;
  }
}

function randRange(a, b) { return a + Math.random() * (b - a); }

function tooClose(p, list, minD) {
  for (const q of list) {
    if (p.distanceTo(q) < minD) return true;
  }
  return false;
}

function pointInPolygonXZ(poly, x, z) {
  // Ray casting
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
  const m = new Matrix4();
  m.compose(
    new Vector3(position.x, position.y, position.z),
    new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
    new Vector3(1,1,1)
  );
  return m;
}

function matrixToQuaternion(m) {
  const q = new Quaternion();
  m.decompose(new Vector3(), q, new Vector3());
  return q;
}

