import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Zielwerte
const FORWARD_DIST = 1.0;   // 1 m Abstand
const HEIGHT_OFFSET = 0.40; // 40 cm über dem Nutzer
const BLOCK_TARGET_SIZE = 0.30; // 30 cm Kantenlänge
const IDLE_ROT_SPEED = 0.25;    // rad/s (langsam um Y drehen)
const BOUNCE_AMPLITUDE = 0.06;  // m
const BOUNCE_DURATION  = 0.35;  // s

export class BlocksManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null; // GLB root
    this.blocks = []; // {mesh, aabb:Box3, cooldown, bounceT, basePos:Vector3}
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

    // Für Passthrough etwas „hellere“ Oberfläche
    root.traverse(o => {
      if (o.isMesh && o.material) {
        if ('metalness' in o.material) o.material.metalness = Math.min(0.2, o.material.metalness ?? 0.2);
        if ('roughness' in o.material) o.material.roughness = Math.max(0.7, o.material.roughness ?? 0.7);
        if ('emissiveIntensity' in o.material) o.material.emissiveIntensity = Math.max(0.15, o.material.emissiveIntensity ?? 0.15);
      }
    });

    this.template = root;
  }

  placeAroundViewer(viewerPos, viewerQuat) {
    // Basisachsen
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewerQuat).normalize();
    const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(viewerQuat).normalize();
    const up      = new THREE.Vector3(0, 1, 0);

    // Vier Richtungen
    const positions = [
      viewerPos.clone().add(forward.clone().multiplyScalar(FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),     // vorne
      viewerPos.clone().add(forward.clone().multiplyScalar(-FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),    // hinten
      viewerPos.clone().add(right.clone().multiplyScalar(FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),       // rechts
      viewerPos.clone().add(right.clone().multiplyScalar(-FORWARD_DIST)).add(up.clone().multiplyScalar(HEIGHT_OFFSET)),      // links
    ];

    for (const pos of positions) {
      const mesh = this.template.clone(true);
      mesh.position.copy(pos);
      // Jeder Block zeigt zum Nutzer (nur um Y drehen)
      const look = new THREE.Vector3(viewerPos.x, mesh.position.y, viewerPos.z);
      mesh.lookAt(look);

      this.scene.add(mesh);

      const aabb = new THREE.Box3().setFromObject(mesh);
      this.blocks.push({
        mesh,
        aabb,
        cooldown: 0,
        bounceT: 0,                 // 0..BOUNCE_DURATION → aktiver Bounce
        basePos: mesh.position.clone()
      });
    }
  }

  updateIdle(dtMs) {
    const dt = (dtMs ?? 16.666) / 1000;
    for (const b of this.blocks) {
      // Idle-Rotation
      b.mesh.rotateY(IDLE_ROT_SPEED * dt);

      // Bounce-Animation (Sinus-Halbperiode)
      if (b.bounceT > 0) {
        b.bounceT = Math.min(BOUNCE_DURATION, b.bounceT + dt);
        const k = b.bounceT / BOUNCE_DURATION; // 0..1
        const yOff = Math.sin(k * Math.PI) * BOUNCE_AMPLITUDE; // hoch & runter
        b.mesh.position.set(b.basePos.x, b.basePos.y + yOff, b.basePos.z);
        if (b.bounceT >= BOUNCE_DURATION) {
          b.bounceT = 0;
          b.mesh.position.copy(b.basePos); // zurücksetzen
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
        // Schnelle Prüfung: Distanzzentrum -> Block-AABB expandiert um Sphere-Radius
        const expanded = block.aabb.clone().expandByScalar(s.radius);
        if (!expanded.containsPoint(s.center)) continue;

        // Ermitteln, ob Schlag NICHT von oben kommt
        const center = expanded.getCenter(new THREE.Vector3());
        const toBlock = center.clone().sub(s.center).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const fromAbove = toBlock.dot(up) < -0.4; // deutlich von oben
        if (fromAbove) continue;

        if (block.cooldown <= 0) {
          // **Top-Center** der Welt-AABB (zentriert!) als Basis
          const topCenter = new THREE.Vector3(center.x, block.aabb.max.y, center.z);
          const spawnPos = topCenter.clone().add(up.clone().multiplyScalar(0.03)); // 3 cm über Oberkante
          bursts.push({ spawnPos, upNormal: up.clone() });

          // Trigger: Bounce + Cooldown
          block.bounceT = 1e-6; // starte Bounce im nächsten updateIdle
          block.cooldown = 30;  // ~0.5s bei 60fps
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
