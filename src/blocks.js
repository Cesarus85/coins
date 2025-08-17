import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Zielwerte
const FORWARD_DIST = 1.0;   // 1 m Abstand
const HEIGHT_OFFSET = 0.40; // 40 cm über dem Nutzer
const BLOCK_TARGET_SIZE = 0.30; // 30 cm Kantenlänge
const IDLE_ROT_SPEED = 0.25;    // rad/s
const BOUNCE_AMPLITUDE = 0.06;  // m
const BOUNCE_DURATION  = 0.35;  // s

export class BlocksManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null; // GLB root (nicht zur Szene hinzufügen!)
    this.blocks = [];     // {mesh, aabb:Box3, cooldown, bounceT, basePos:Vector3}
    this._placed = false; // Einmal-Guard
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

    // WICHTIG: Template bleibt nur als Blaupause – nicht zur Szene hinzufügen!
    this.template = root;
  }

  clear() {
    for (const b of this.blocks) {
      b.mesh?.removeFromParent();
      // Geometrie/Materialien nicht entsorgen, weil von mehreren Klonen geteilt sein könnten
    }
    this.blocks.length = 0;
    this._placed = false;
  }

  dispose() {
    this.clear();
    // Template aufräumen
    if (this.template) {
      this.template.traverse(o => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          const m = o.material;
          if (m) {
            if (Array.isArray(m)) m.forEach(x => x.dispose?.());
            else m.dispose?.();
          }
        }
      });
    }
    this.template = null;
  }

  placeAroundViewer(viewerPos, viewerQuat) {
    if (this._placed) return; // Einmal-Guard
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
      // Blick zum Nutzer (nur um Y)
      const look = new THREE.Vector3(viewerPos.x, mesh.position.y, viewerPos.z);
      mesh.lookAt(look);

      // Sicherheitsmaßnahme: frustumCulled aktiv lassen (Standard)
      mesh.frustumCulled = true;

      this.scene.add(mesh);

      const aabb = new THREE.Box3().setFromObject(mesh);
      this.blocks.push({
        mesh,
        aabb,
        cooldown: 0,
        bounceT: 0,
        basePos: mesh.position.clone()
      });
    }
  }

  updateIdle(dtMs) {
    const dt = (dtMs ?? 16.666) / 1000;

    // **Notbremse**: sollten sich aus irgendeinem Grund Duplikate eingeschlichen haben,
    // entferne alles über 4.
    if (this.blocks.length > 4) {
      for (let i = 4; i < this.blocks.length; i++) {
        this.blocks[i].mesh?.removeFromParent();
      }
      this.blocks.length = 4;
      // Kein return – wir updaten die verbliebenen 4 regulär weiter
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

  // Kollisionen und Münz-Spawn
  testHitsAndGetBursts(spheres) {
    const bursts = [];
    for (const block of this.blocks) {
      if (block.cooldown > 0) block.cooldown -= 1;

      // AABB frisch
      block.aabb.setFromObject(block.mesh);

      for (const s of spheres) {
        // Bounding-Box „aufblasen“
        const expanded = block.aabb.clone().expandByScalar(s.radius);
        if (!expanded.containsPoint(s.center)) continue;

        // Nicht von oben
        const center = expanded.getCenter(new THREE.Vector3());
        const toBlock = center.clone().sub(s.center).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const fromAbove = toBlock.dot(up) < -0.4;
        if (fromAbove) continue;

        if (block.cooldown <= 0) {
          // Top-Center (zentriert)
          const topCenter = new THREE.Vector3(center.x, block.aabb.max.y, center.z);
          const spawnPos = topCenter.clone().add(up.clone().multiplyScalar(0.03)); // 3 cm darüber

          bursts.push({ spawnPos, upNormal: up.clone() });

          // Trigger Bounce + Cooldown
          block.bounceT = 1e-6;
          block.cooldown = 30; // ~0.5 s
        }
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
