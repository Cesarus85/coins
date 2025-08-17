import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Zielwerte
const FORWARD_DIST = 1.0;   // 1 m vor dem Nutzer
const HEIGHT_OFFSET = 0.40; // 40 cm über dem Nutzer
const H_SPACING = 0.45;     // Abstand zwischen den 3 Blöcken
const BLOCK_TARGET_SIZE = 0.30; // 30 cm Kantenlänge (etwas größer)

export class BlocksManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null; // GLB root
    this.blocks = []; // {mesh, size, aabb:Box3, cooldown:number}
  }

  async ensureLoaded() {
    if (this.template) return;
    const gltf = await this._load('./assets/wuerfel.glb');
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('wuerfel.glb ohne Szene');

    // Auto-Scale auf BLOCK_TARGET_SIZE (würfelig angenommen)
    const bounds = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const srcEdge = Math.max(size.x, size.y, size.z) || 1;
    const scale = BLOCK_TARGET_SIZE / srcEdge;
    root.scale.setScalar(scale);

    // Materialien etwas „crisper“ für Passthrough
    root.traverse(o => {
      if (o.isMesh && o.material) {
        if ('metalness' in o.material) o.material.metalness = Math.min(0.2, o.material.metalness ?? 0.2);
        if ('roughness' in o.material) o.material.roughness = Math.max(0.7, o.material.roughness ?? 0.7);
      }
    });

    this.template = root;
  }

  placeRelativeTo(viewerPos, viewerQuat) {
    // Vorwärts- und Rechtsvektoren aus Blickrichtung
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewerQuat).normalize();
    const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(viewerQuat).normalize();
    const up      = new THREE.Vector3(0, 1, 0);

    // Mittlere Position (1 m vor, 0.4 m hoch)
    const center = viewerPos.clone()
      .add(forward.clone().multiplyScalar(FORWARD_DIST))
      .add(up.clone().multiplyScalar(HEIGHT_OFFSET));

    // Drei Positionen: links – mitte – rechts
    const offsets = [-H_SPACING, 0, H_SPACING];
    for (const off of offsets) {
      const pos = center.clone().add(right.clone().multiplyScalar(off));
      const mesh = this.template.clone(true);
      mesh.position.copy(pos);
      // Blöcke leicht zum Nutzer „drehen“
      mesh.lookAt(viewerPos.x, mesh.position.y, viewerPos.z);
      this.scene.add(mesh);

      const aabb = new THREE.Box3().setFromObject(mesh);
      this.blocks.push({ mesh, size: BLOCK_TARGET_SIZE, aabb, cooldown: 0 });
    }
  }

  // Liefert Coin-Bursts nach Detektion von Hits
  testHitsAndGetBursts(spheres) {
    const bursts = [];
    for (const block of this.blocks) {
      // Cooldown verringern
      if (block.cooldown > 0) block.cooldown -= 1;

      // AABB aktualisieren
      block.aabb.setFromObject(block.mesh);

      for (const s of spheres) {
        // Schnelle Prüfung: Distanzzentrum -> Block-AABB expandiert um Sphere-Radius
        const expanded = block.aabb.clone().expandByScalar(s.radius);
        if (!expanded.containsPoint(s.center)) continue;

        // Richtung des Schlages beurteilen: „nicht von oben“
        const blockCenter = expanded.getCenter(new THREE.Vector3());
        const toBlock = blockCenter.clone().sub(s.center).normalize(); // Richtung vom Sphere zum Block
        const up = new THREE.Vector3(0, 1, 0);

        // dot > 0.4 heißt: Sphere ist deutlich unter dem Block (schlägt von unten),
        // |horiz| groß → seitlich. Ablehnen nur, wenn klar von oben (dot < -0.4)
        const dotUp = toBlock.dot(up);
        const fromAbove = dotUp < -0.4;
        if (fromAbove) continue;

        // Cooldown, damit nicht mehrfach pro Frame getriggert wird
        if (block.cooldown <= 0) {
          // Spawn-Position leicht über dem Block
          const spawnPos = block.aabb.max.clone();
          spawnPos.y += 0.05; // 5cm über Oberkante
          bursts.push({ spawnPos, upNormal: up.clone() });
          block.cooldown = 30; // ~0.5s bei 60fps
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
