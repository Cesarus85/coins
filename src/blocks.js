import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Zielwerte
const FORWARD_DIST = 1.0;    // 1 m Abstand
const HEIGHT_OFFSET = 0.40;  // 40 cm über dem Nutzer
const BLOCK_TARGET_SIZE = 0.30; // 30 cm Kantenlänge
const IDLE_ROT_SPEED = 0.25; // rad/s
const BOUNCE_AMPLITUDE = 0.06; // m
const BOUNCE_DURATION  = 0.35; // s

// Anti-„Dauerfeuer“-Hysterese
const REARM_NO_CONTACT_FRAMES = 8;    // erst re-armen, wenn ~8 Frames lang kein Kontakt war
const MIN_FIRE_INTERVAL_S      = 0.35; // min. 350 ms zwischen zwei Auslösungen

export class BlocksManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null; // GLB root (nur Blaupause)
    // blocks: {mesh, aabb, bounceT, basePos, armed, noContactFrames, lastFireAt}
    this.blocks = [];
    this._placed = false;
  }

  async ensureLoaded() {
    if (this.template) return;
    const gltf = await this._load('./assets/wuerfel.glb');
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('wuerfel.glb ohne Szene');

    // Auto-Scale auf BLOCK_TARGET_SIZE (größte Kante)
    const bounds = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const srcEdge = Math.max(size.x, size.y, size.z) || 1;
    const scale = BLOCK_TARGET_SIZE / srcEdge;
    root.scale.setScalar(scale);

    // Heller für Passthrough
    root.traverse(o => {
      if (o.isMesh && o.material) {
        if ('metalness' in o.material) o.material.metalness = Math.min(0.2, o.material.metalness ?? 0.2);
        if ('roughness' in o.material) o.material.roughness = Math.max(0.7, o.material.roughness ?? 0.7);
        if ('emissiveIntensity' in o.material) o.material.emissiveIntensity = Math.max(0.15, o.material.emissiveIntensity ?? 0.15);
      }
    });

    this.template = root;
  }

  clear() {
    for (const b of this.blocks) b.mesh?.removeFromParent();
    this.blocks.length = 0;
    this._placed = false;
  }

  dispose() {
    this.clear();
    if (this.template) {
      this.template.traverse(o => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          const m = o.material;
          if (m) Array.isArray(m) ? m.forEach(x => x.dispose?.()) : m.dispose?.();
        }
      });
    }
    this.template = null;
  }

  placeAroundViewer(viewerPos, viewerQuat) {
    if (this._placed) return;
    this._placed = true;

    // Basisachsen
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewerQuat).normalize();
    const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(viewerQuat).normalize();
    const up      = new THREE.Vector3(0, 1, 0);

    // Vier Positionen: vorne, hinten, rechts, links
    const positions = [
      viewerPos.clone().add(forward.clone().multiplyScalar(FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),
      viewerPos.clone().add(forward.clone().multiplyScalar(-FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),
      viewerPos.clone().add(right.clone().multiplyScalar(FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),
      viewerPos.clone().add(right.clone().multiplyScalar(-FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),
    ];

    for (const pos of positions) {
      const mesh = this.template.clone(true);
      mesh.position.copy(pos);
      const look = new THREE.Vector3(viewerPos.x, mesh.position.y, viewerPos.z);
      mesh.lookAt(look);
      mesh.frustumCulled = true;
      this.scene.add(mesh);

      const aabb = new THREE.Box3().setFromObject(mesh);
      this.blocks.push({
        mesh,
        aabb,
        bounceT: 0,
        basePos: mesh.position.clone(),
        armed: true,
        noContactFrames: 0,
        lastFireAt: -Infinity
      });
    }
  }

  updateIdle(dtMs) {
    const dt = (dtMs ?? 16.666) / 1000;

    // Notbremse: max. 4 Blöcke
    if (this.blocks.length > 4) {
      for (let i = 4; i < this.blocks.length; i++) this.blocks[i].mesh?.removeFromParent();
      this.blocks.length = 4;
    }

    for (const b of this.blocks) {
      // Idle-Rotation
      b.mesh.rotateY(IDLE_ROT_SPEED * dt);

      // Bounce-Animation
      if (b.bounceT > 0) {
        b.bounceT = Math.min(BOUNCE_DURATION, b.bounceT + dt);
        const k = b.bounceT / BOUNCE_DURATION; // 0..1
        const yOff = Math.sin(k * Math.PI) * BOUNCE_AMPLITUDE;
        b.mesh.position.set(b.basePos.x, b.basePos.y + yOff, b.basePos.z);
        if (b.bounceT >= BOUNCE_DURATION) {
          b.bounceT = 0;
          b.mesh.position.copy(b.basePos);
        }
      }

      // AABB erneuern
      b.aabb.setFromObject(b.mesh);
    }
  }

  /**
   * Kollisionen und Münz-Spawn mit robuster Sphere-AABB-Test + Hysterese:
   * - Feuert NUR wenn: armed === true, Kontakt JETZT besteht, nicht von oben, und Mindestabstand seit letztem Fire eingehalten.
   * - Rearm erst, wenn mehrere Frames lang KEIN Kontakt besteht.
   */
  testHitsAndGetBursts(spheres) {
    const bursts = [];
    const up = new THREE.Vector3(0, 1, 0);
    const now = performance.now() / 1000;

    for (const block of this.blocks) {
      block.aabb.setFromObject(block.mesh);

      let anyContact = false;
      let fired = false;

      // Mittelpunkt der AABB (für Top-Center & Richtungscheck)
      const aabbCenter = block.aabb.getCenter(new THREE.Vector3());

      for (const s of spheres) {
        // Robuste Sphere vs AABB: Distanz vom Sphere-Zentrum zum nächstgelegenen Punkt der AABB
        const closest = new THREE.Vector3(
          THREE.MathUtils.clamp(s.center.x, block.aabb.min.x, block.aabb.max.x),
          THREE.MathUtils.clamp(s.center.y, block.aabb.min.y, block.aabb.max.y),
          THREE.MathUtils.clamp(s.center.z, block.aabb.min.z, block.aabb.max.z),
        );
        const dx = s.center.x - closest.x;
        const dy = s.center.y - closest.y;
        const dz = s.center.z - closest.z;
        const distSq = dx*dx + dy*dy + dz*dz;

        // Kontakt, wenn Distanz <= Radius (mit leichter Reserve)
        const rContact = s.radius * 1.02;
        if (distSq > rContact * rContact) continue;

        anyContact = true;

        // Nicht von oben
        const toBlock = aabbCenter.clone().sub(s.center).normalize();
        const fromAbove = toBlock.dot(up) < -0.4;
        if (fromAbove) continue;

        if (!fired && block.armed && (now - block.lastFireAt) >= MIN_FIRE_INTERVAL_S) {
          // Top-Center (zentriert)
          const topCenter = new THREE.Vector3(aabbCenter.x, block.aabb.max.y, aabbCenter.z);
          const spawnPos = topCenter.clone().add(up.clone().multiplyScalar(0.03)); // 3 cm darüber

          bursts.push({ spawnPos, upNormal: up.clone() });

          block.bounceT = 1e-6;
          block.armed = false;
          block.lastFireAt = now;
          fired = true;
        }
      }

      // Rearm-Logik mit Hysterese: nur wenn mehrere Frames lang KEIN Kontakt
      if (!anyContact) {
        block.noContactFrames++;
        if (block.noContactFrames >= REARM_NO_CONTACT_FRAMES) {
          block.armed = true;
          block.noContactFrames = 0;
        }
      } else {
        block.noContactFrames = 0; // solange Kontakt, nicht re-armen
      }
    }

    return bursts;
  }

  _load(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }
}
