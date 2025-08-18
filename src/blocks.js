// ./src/blocks.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Platzierung / Animation
const FORWARD_DIST = 1.0;     // Abstand vom Spieler
const HEIGHT_OFFSET = 0.40;   // etwas über Augenhöhe
const BLOCK_TARGET_SIZE = 0.30; // Ziel-Kantenlänge der Würfel
const IDLE_ROT_SPEED = 0.25;  // rad/s
const BOUNCE_AMPLITUDE = 0.06;
const BOUNCE_DURATION  = 0.35; // s pro Bounce

// Anti-Dauerfeuer
const REARM_NO_CONTACT_FRAMES = 8;
const MIN_FIRE_INTERVAL_S     = 0.35;

// AABB nicht jeden Frame neu berechnen
const AABB_REFRESH_RATE = 3; // alle 3 Frames

export class BlocksManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null;

    /** @type {{mesh:THREE.Object3D,aabb:THREE.Box3,bounceT:number,basePos:THREE.Vector3,armed:boolean,noContactFrames:number,lastFireAt:number}[]} */
    this.blocks = [];

    this._frame = 0;

    // temps
    this._tmpCenter = new THREE.Vector3();
    this._tmpClosest = new THREE.Vector3();
    this._up         = new THREE.Vector3(0,1,0);
  }

  // ---------- Lifecycle ----------
  async ensureLoaded() {
    if (this.template) return;

    const gltf = await new Promise((resolve, reject) => {
      this.loader.load('./assets/wuerfel.glb', resolve, undefined, reject);
    });
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('wuerfel.glb ohne Szene');

    // auf Zielgröße skalieren
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3(); box.getSize(size);
    const maxSide = Math.max(size.x, size.y, size.z) || 1;
    const scale = BLOCK_TARGET_SIZE / maxSide;
    root.scale.setScalar(scale);

    // Materialien etwas XR-freundlicher
    root.traverse(o => {
      if (o.isMesh && o.material) {
        o.material.depthWrite = true;
        o.material.depthTest  = true;
      }
      // Shadow-Settings optional – falls genutzt
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });

    // als Template merken
    this.template = root;
  }

  clear() {
    for (const b of this.blocks) {
      b.mesh.removeFromParent();
    }
    this.blocks.length = 0;
  }

  /**
   * Platziert vier Blöcke (vorne, hinten, rechts, links) um den Viewer herum.
   * @param {THREE.Vector3} viewerPos
   * @param {THREE.Quaternion} viewerQuat
   */
  placeAroundViewer(viewerPos, viewerQuat) {
    if (!this.template) throw new Error('ensureLoaded() vor placeAroundViewer() aufrufen');

    this.clear();

    // lokale Achsen aus der Kopfhaltung
    const forward = new THREE.Vector3(0,0,-1).applyQuaternion(viewerQuat).setY(0).normalize();
    const right   = new THREE.Vector3().crossVectors(forward, this._up).normalize().negate(); // XR: rechtsherum
    const up      = this._up;

    const positions = [
      viewerPos.clone().add(forward.clone().multiplyScalar(FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),
      viewerPos.clone().add(forward.clone().multiplyScalar(-FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),
      viewerPos.clone().add(right.clone().multiplyScalar(FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),
      viewerPos.clone().add(right.clone().multiplyScalar(-FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),
    ];

    for (const pos of positions) {
      const mesh = this.template.clone(true);
      mesh.position.copy(pos);

      // horizontal zum Spieler ausrichten
      const look = new THREE.Vector3(viewerPos.x, mesh.position.y, viewerPos.z);
      mesh.lookAt(look);
      mesh.frustumCulled = true;

      this.scene.add(mesh);

      const aabb = new THREE.Box3().setFromObject(mesh);
      this.blocks.push({
        mesh, aabb,
        bounceT: 0,
        basePos: mesh.position.clone(),
        armed: true,
        noContactFrames: 0,
        lastFireAt: -Infinity
      });
    }
  }

  // ---------- Update ----------
  /** Idle-Rotation + sanftes „Bouncing“ animieren. */
  updateIdle(dtMs) {
    const dt = Math.max(0, (dtMs ?? 0) / 1000);
    this._frame++;

    for (const b of this.blocks) {
      // Rotation
      b.mesh.rotation.y += IDLE_ROT_SPEED * dt;

      // Bounce ablaufen lassen
      if (b.bounceT > 0) {
        b.bounceT = Math.max(0, b.bounceT - dt);
      }
      const t = THREE.MathUtils.clamp(1 - b.bounceT / BOUNCE_DURATION, 0, 1);
      const yOff = Math.sin(t * Math.PI) * BOUNCE_AMPLITUDE * (b.bounceT > 0 ? 1 : 0);
      b.mesh.position.set(b.basePos.x, b.basePos.y + yOff, b.basePos.z);

      // AABB nicht jeden Frame
      if (this._frame % AABB_REFRESH_RATE === 0) {
        b.aabb.setFromObject(b.mesh);
      }
    }
  }

  /**
   * Prüft Kollisionen gegen Interaktionssphären und liefert Coin-/Fail-Bursts zurück.
   * Erwartete Sphere-Struktur: { center: THREE.Vector3, radius: number, velocity?: THREE.Vector3 }
   * @param {{center:THREE.Vector3, radius:number, velocity?:THREE.Vector3}[]} spheres
   * @returns {{spawnPos:THREE.Vector3, upNormal:THREE.Vector3}[]}
   */
  testHitsAndGetBursts(spheres) {
    if (!Array.isArray(spheres) || !spheres.length) return [];
    const now = performance.now() / 1000;
    const bursts = [];

    for (const block of this.blocks) {
      let anyContact = false;

      for (const s of spheres) {
        if (!s?.center || !s?.radius) continue;

        // Abstand Sphere <-> AABB
        block.aabb.clampPoint(s.center, this._tmpClosest);
        const dist = this._tmpClosest.distanceTo(s.center);
        const overlap = s.radius - dist;

        if (overlap > 0) {
          anyContact = true;

          // nur „Schlag nach oben“ zählen (optional)
          const v = s.velocity || this._up; // Fallback
          const upDot = v.clone().normalize().dot(this._up);

          const canFire = block.armed &&
                          (now - block.lastFireAt) > MIN_FIRE_INTERVAL_S &&
                          upDot > 0.2; // kleiner Schwellenwert

          if (canFire) {
            block.lastFireAt = now;
            block.armed = false;
            block.bounceT = BOUNCE_DURATION;

            // Spawn-Position = AABB-Top-Mitte
            block.aabb.getCenter(this._tmpCenter);
            const spawnPos = new THREE.Vector3(this._tmpCenter.x, block.aabb.max.y, this._tmpCenter.z);
            bursts.push({ spawnPos, upNormal: this._up.clone() });
          }
        }
      }

      // Rearm-Logik
      if (!anyContact) {
        block.noContactFrames++;
        if (block.noContactFrames >= REARM_NO_CONTACT_FRAMES) {
          block.armed = true;
          block.noContactFrames = 0;
        }
      } else {
        block.noContactFrames = 0;
      }
    }

    return bursts;
  }
}
