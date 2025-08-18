// /src/blocks.js
import * as THREE from 'three';

const BLOCK_SIZE_M       = 0.32;     // Ziel-Kantenlänge des Würfels (m)
const VIEWER_FWD_DIST_M  = 1.15;     // Distanz vor dem Spieler
const GRID_OFFS_M        = 0.42;     // seitlicher/longitudinaler Versatz für das 2x2-Grid
const HEIGHT_OFFSET_M    = -0.15;    // leicht unter Augenhöhe platzieren
const IDLE_ROT_SPEED_MIN = 0.4;      // rad/s
const IDLE_ROT_SPEED_MAX = 0.9;      // rad/s
const HIT_REARM_MS       = 420;      // Entprellzeit pro Block
const HIT_GROW_EPS_M     = 0.02;     // AABB-Erweiterung für Kontakt

export class BlocksManager {
  constructor(scene) {
    this.scene = scene;
    /** @type {Array<{mesh:THREE.Object3D, aabb:THREE.Box3, nextArmTime:number, rotAxis:THREE.Vector3, rotSpeed:number}>} */
    this.blocks = [];
    this._tmpBox = new THREE.Box3();
    this._tmpVec = new THREE.Vector3();
    this._tmpMat = new THREE.Matrix4();
  }

  async ensureLoaded() {
    // Prozedurale Würfel brauchen kein Asset-Preload.
    return true;
  }

  clear() {
    for (const b of this.blocks) b.mesh.removeFromParent();
    this.blocks.length = 0;
  }

  dispose() {
    this.clear();
  }

  /**
   * Spawnt genau 4 Würfel in einem Quadrat um die Blickrichtung.
   * @param {THREE.Vector3} viewerPos
   * @param {THREE.Quaternion} viewerQuat
   */
  placeAroundViewer(viewerPos, viewerQuat) {
    this.clear();

    // Basisachsen aus Blickrichtung
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewerQuat).setY(0).normalize();
    const right   = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
    const center  = viewerPos.clone().addScaledVector(forward, VIEWER_FWD_DIST_M);
    const y       = viewerPos.y + HEIGHT_OFFSET_M;

    // 2×2-Layout (vorne/hinten × links/rechts)
    const offsets = [
      { f:  1, r: -1 }, // vorne-links
      { f:  1, r:  1 }, // vorne-rechts
      { f: -1, r: -1 }, // hinten-links
      { f: -1, r:  1 }, // hinten-rechts
    ];

    for (let i = 0; i < 4; i++) {
      const o = offsets[i];
      const pos = center.clone()
        .addScaledVector(forward, o.f * GRID_OFFS_M)
        .addScaledVector(right,   o.r * GRID_OFFS_M);
      pos.y = y;

      const mesh = this.makeBlockMesh();
      mesh.position.copy(pos);

      // leichte Zufallsdrehung und Idle-Parameter
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(0,1,0));
      mesh.rotateY((Math.random() - 0.5) * Math.PI);
      const rotAxis  = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
      const rotSpeed = THREE.MathUtils.lerp(IDLE_ROT_SPEED_MIN, IDLE_ROT_SPEED_MAX, Math.random());

      this.scene.add(mesh);

      const aabb = new THREE.Box3().setFromObject(mesh).expandByScalar(HIT_GROW_EPS_M);
      this.blocks.push({
        mesh,
        aabb,
        nextArmTime: 0,
        rotAxis,
        rotSpeed,
      });
    }
  }

  /**
   * Erzeugt einen einzelnen Würfel (BoxGeometry) – ersetze das bei Bedarf durch dein GLB.
   */
  makeBlockMesh() {
    const g = new THREE.BoxGeometry(BLOCK_SIZE_M, BLOCK_SIZE_M, BLOCK_SIZE_M);
    const m = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.2,
      roughness: 0.6
    });
    // rote Kante als dezent sichtbare Outline
    const group = new THREE.Group();
    const cube  = new THREE.Mesh(g, m);
    cube.castShadow = cube.receiveShadow = false;
    group.add(cube);

    // optional: dünner Rahmen
    const edgeGeo = new THREE.EdgesGeometry(g);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xaa2222, linewidth: 1 });
    const edges   = new THREE.LineSegments(edgeGeo, edgeMat);
    group.add(edges);

    return group;
    // --- Wenn du ein GLB willst:
    // const loader = new GLTFLoader(); // (oben importieren)
    // ...load + scale auf BLOCK_SIZE_M
  }

  /**
   * Sanfte Idle-Animation (Rotation).
   * @param {number} dtMs
   */
  updateIdle(dtMs) {
    const dt = dtMs / 1000;
    for (const b of this.blocks) {
      b.mesh.rotateOnAxis(b.rotAxis, b.rotSpeed * dt);
      // AABB neu berechnen (sparsam – hier jedes Frame ok bei 4 Blöcken)
      b.aabb.setFromObject(b.mesh).expandByScalar(HIT_GROW_EPS_M);
    }
  }

  /**
   * Prüft Sphärenkontakte gegen Block-AABBs und gibt Bursts zurück.
   * @param {Array<{center:THREE.Vector3, radius:number}>} spheres
   * @returns {Array<{spawnPos:THREE.Vector3, upNormal:THREE.Vector3, blockIndex:number}>}
   */
  testHitsAndGetBursts(spheres) {
    const now = performance.now();
    const bursts = [];

    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (now < b.nextArmTime) continue; // noch im Cooldown

      // Sphären/AABB Test
      let hit = false;
      for (const s of spheres) {
        if (s.radius <= 0) continue;
        if (this._intersectsSphereAABB(s.center, s.radius, b.aabb)) { hit = true; break; }
      }
      if (!hit) continue;

      // Entprellen
      b.nextArmTime = now + HIT_REARM_MS;

      // Burst-Position = obere Mitte der Block-AABB
      const spawnPos = new THREE.Vector3(
        (b.aabb.min.x + b.aabb.max.x) * 0.5,
        b.aabb.max.y + 0.02,
        (b.aabb.min.z + b.aabb.max.z) * 0.5
      );
      const upNormal = new THREE.Vector3(0, 1, 0);

      bursts.push({ spawnPos, upNormal, blockIndex: i });
    }

    return bursts;
  }

  // ---------- intern ----------

  /**
   * Schneller Sphere/AABB-Test.
   * @param {THREE.Vector3} c
   * @param {number} r
   * @param {THREE.Box3} box
   */
  _intersectsSphereAABB(c, r, box) {
    // clamp center to box, dann Distanz vergleichen
    const x = Math.max(box.min.x, Math.min(c.x, box.max.x));
    const y = Math.max(box.min.y, Math.min(c.y, box.max.y));
    const z = Math.max(box.min.z, Math.min(c.z, box.max.z));
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    return (dx*dx + dy*dy + dz*dz) <= (r * r);
  }
}
