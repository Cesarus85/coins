import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FORWARD_DIST = 1.0;
const HEIGHT_OFFSET = 0.40;
const BLOCK_TARGET_SIZE = 0.30;
const IDLE_ROT_SPEED = 0.25;
const BOUNCE_AMPLITUDE = 0.06;
const BOUNCE_DURATION  = 0.35;

// Anti-„Dauerfeuer“
const REARM_NO_CONTACT_FRAMES = 8;
const MIN_FIRE_INTERVAL_S      = 0.35;

// Performance: AABB nicht jeden Frame neu (bei langsamer Idle-Rotation reicht 1/3)
const AABB_REFRESH_RATE = 3; // alle 3 Frames

export class BlocksManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null;
    this.blocks = []; // {mesh,aabb,bounceT,basePos,armed,noContactFrames,lastFireAt}
    this._placed = false;
    this._frameCounter = 0;
    // Reusable temporaries
    this._tmpCenter = new THREE.Vector3();
    this._tmpClosest = new THREE.Vector3();
    this._up = new THREE.Vector3(0,1,0);
  }

  async ensureLoaded() {
    if (this.template) return;
    const gltf = await this._load('./assets/wuerfel.glb');
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('wuerfel.glb ohne Szene');

    const bounds = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3(); bounds.getSize(size);
    const srcEdge = Math.max(size.x, size.y, size.z) || 1;
    const scale = BLOCK_TARGET_SIZE / srcEdge;
    root.scale.setScalar(scale);

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

    const forward = new THREE.Vector3(0,0,-1).applyQuaternion(viewerQuat).normalize();
    const right   = new THREE.Vector3(1,0,0).applyQuaternion(viewerQuat).normalize();
    const up      = new THREE.Vector3(0,1,0);

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
        mesh, aabb,
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
    this._frameCounter++;

    // Notbremse
    if (this.blocks.length > 4) {
      for (let i = 4; i < this.blocks.length; i++) this.blocks[i].mesh?.removeFromParent();
      this.blocks.length = 4;
    }

    // Rotation + Bounce
    for (const b of this.blocks) {
      b.mesh.rotateY(IDLE_ROT_SPEED * dt);
      if (b.bounceT > 0) {
        b.bounceT = Math.min(BOUNCE_DURATION, b.bounceT + dt);
        const k = b.bounceT / BOUNCE_DURATION;
        const yOff = Math.sin(k * Math.PI) * BOUNCE_AMPLITUDE;
        b.mesh.position.set(b.basePos.x, b.basePos.y + yOff, b.basePos.z);
        if (b.bounceT >= BOUNCE_DURATION) {
          b.bounceT = 0;
          b.mesh.position.copy(b.basePos);
        }
      }
      // AABB nur alle N Frames refreshen
      if (this._frameCounter % AABB_REFRESH_RATE === 0) {
        b.aabb.setFromObject(b.mesh);
      }
    }
  }

  testHitsAndGetBursts(spheres) {
    const bursts = [];
    const up = this._up;
    const now = performance.now() / 1000;

    for (const block of this.blocks) {
      // bei seltenerem Refresh evtl. initial sicherstellen:
      block.aabb.setFromObject(block.mesh);

      let anyContact = false; let fired = false;

      const center = block.aabb.getCenter(this._tmpCenter);

      for (const s of spheres) {
        // Sphere vs AABB
        const c = this._tmpClosest;
        c.set(
          THREE.MathUtils.clamp(s.center.x, block.aabb.min.x, block.aabb.max.x),
          THREE.MathUtils.clamp(s.center.y, block.aabb.min.y, block.aabb.max.y),
          THREE.MathUtils.clamp(s.center.z, block.aabb.min.z, block.aabb.max.z),
        );
        const dx = s.center.x - c.x, dy = s.center.y - c.y, dz = s.center.z - c.z;
        const distSq = dx*dx + dy*dy + dz*dz;
        const r = s.radius * 1.02;
        if (distSq > r*r) continue;

        anyContact = true;

        // nicht von oben
        const toBlock = center.clone().sub(s.center).normalize();
        const fromAbove = toBlock.dot(up) < -0.4;
        if (fromAbove) continue;

        if (!fired && block.armed && (now - block.lastFireAt) >= MIN_FIRE_INTERVAL_S) {
          const topCenter = new THREE.Vector3(center.x, block.aabb.max.y, center.z);
          const spawnPos = topCenter.addScaledVector(up, 0.03);
          bursts.push({ spawnPos, upNormal: up.clone() });

          block.bounceT = 1e-6;
          block.armed = false;
          block.lastFireAt = now;
          fired = true;
        }
      }

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

  _load(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }
}
