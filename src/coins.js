import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Münze groß (4× vorher): Ø 14 cm
const COIN_DIAMETER = 0.14;
const GRAVITY = -3.8;        // m/s²
const LIFETIME = 1.2;        // s
const COIN_SPAWN_LIFT = 0.12; // 12 cm über Blockoberkante

export class CoinManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null;
    this.scale = 1;
    this.coins = []; // { mesh, vel:Vector3, rotSpeed:number, t:number }
    this.score = 0;
  }

  // Öffentlich, damit von außen (Warmup) aufgerufen werden kann
  async ensureLoaded() {
    if (this.template) return;
    await this._loadTemplate();
  }

  async _loadTemplate() {
    const gltf = await this._load('./assets/coin.glb');
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('coin.glb ohne Szene');

    // Auto-Scale auf Ø 14 cm
    const bounds = new THREE.Box3().setFromObject(root);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const srcDiameter = (isFinite(sphere.radius) && sphere.radius > 0) ? sphere.radius * 2 : 1;
    this.scale = COIN_DIAMETER / srcDiameter;

    // Material etwas heller fürs Passthrough
    root.traverse(o => {
      if (o.isMesh && o.material) {
        if (!o.material.emissive) o.material.emissive = new THREE.Color(0x6a5200);
        if ('emissiveIntensity' in o.material) o.material.emissiveIntensity = Math.max(0.35, o.material.emissiveIntensity ?? 0.35);
        if ('metalness' in o.material) o.material.metalness = Math.max(0.75, o.material.metalness ?? 0.75);
        if ('roughness' in o.material) o.material.roughness = Math.min(0.3, o.material.roughness ?? 0.3);
        if ('opacity' in o.material) { o.material.transparent = true; o.material.opacity = 1.0; }
      }
    });

    this.template = root;
  }

  // Für Pipeline-Warmup (unsichtbare, weit außerhalb liegende Instanz)
  _makePreviewInstance() {
    if (!this.template) return null;
    const coin = this.template.clone(true);
    coin.scale.setScalar(this.scale);
    coin.position.set(0, -100, 0);
    coin.rotateY(Math.random() * Math.PI * 2);
    coin.rotateX(Math.PI / 2);
    return coin;
  }

  async spawnBurst(worldPos, upNormal = new THREE.Vector3(0,1,0)) {
    if (!this.template) await this._loadTemplate();

    // === Coin ===
    const coin = this.template.clone(true);
    coin.scale.setScalar(this.scale);

    // Coin höher spawnen (12 cm über Oberkante)
    const liftedPos = worldPos.clone().add(upNormal.clone().multiplyScalar(COIN_SPAWN_LIFT));
    coin.position.copy(liftedPos);

    // 90°-Drehung, zufällige Y-Rotation
    coin.rotateY(Math.random() * Math.PI * 2);
    coin.rotateX(Math.PI / 2);

    coin.traverse(o => {
      if (o.isMesh && o.material && ('emissiveIntensity' in o.material)) {
        o.material = o.material.clone();
        o.material.emissiveIntensity = (o.material.emissiveIntensity ?? 0.35) * (0.95 + Math.random() * 0.25);
        if ('opacity' in o.material) { o.material.transparent = true; o.material.opacity = 1.0; }
      }
    });

    this.scene.add(coin);

    // Startgeschwindigkeit: nach oben + sehr kleine seitliche Varianz (kompakt)
    const vel = upNormal.clone().multiplyScalar(1.4);
    vel.x += (Math.random() - 0.5) * 0.08;
    vel.z += (Math.random() - 0.5) * 0.08;

    const rotSpeed = 9 + Math.random() * 3; // rad/s
    this.coins.push({ mesh: coin, vel, rotSpeed, t: 0 });

    this.score += 1;
  }

  update(dtMs) {
    const dt = (dtMs ?? 16.666) / 1000;

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt;

      // Physik
      c.vel.y += GRAVITY * dt;
      c.mesh.position.addScaledVector(c.vel, dt);

      // Rotation
      c.mesh.rotateY(c.rotSpeed * dt);

      // Fade-out
      const k = Math.min(1, c.t / LIFETIME);
      const scale = 1 + 0.25 * Math.sin(k * Math.PI);
      c.mesh.scale.setScalar(this.scale * scale);

      c.mesh.traverse(o => {
        if (o.isMesh && o.material && ('emissiveIntensity' in o.material)) {
          o.material.emissiveIntensity = (1 - k) * 0.8;
          if ('opacity' in o.material) o.material.opacity = 1 - k;
        }
      });

      if (c.t >= LIFETIME) {
        c.mesh.removeFromParent();
        this.coins.splice(i, 1);
      }
    }
  }

  _load(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }
}
