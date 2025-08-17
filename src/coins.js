import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Frühere Zielgröße war Ø 3.5 cm → jetzt 4× so groß = Ø 14 cm
const COIN_DIAMETER = 0.14;              // Meter
const COIN_RADIUS   = COIN_DIAMETER / 2;

const GRAVITY = -3.8; // m/s² (leicht reduziertes „Mario“-Gefühl)
const LIFETIME = 1.2; // Sek.

export class CoinManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null;
    this.scale = 1;
    this.coins = []; // {mesh, vel:Vector3, rotSpeed:number, t:number}
    this.score = 0;
  }

  async _ensureLoaded() {
    if (this.template) return;
    const gltf = await this._load('./assets/coin.glb');
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('coin.glb ohne Szene');

    // Auto-Scale: auf Ø 14 cm skalieren
    const bounds = new THREE.Box3().setFromObject(root);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const srcDiameter = (isFinite(sphere.radius) && sphere.radius > 0) ? sphere.radius * 2 : 1;
    this.scale = COIN_DIAMETER / srcDiameter;

    root.traverse(o => {
      if (o.isMesh && o.material) {
        if (!o.material.emissive) o.material.emissive = new THREE.Color(0x5a4300);
        if ('emissiveIntensity' in o.material) o.material.emissiveIntensity = Math.max(0.22, o.material.emissiveIntensity ?? 0.22);
        if ('metalness' in o.material) o.material.metalness = Math.max(0.7, o.material.metalness ?? 0.7);
        if ('roughness' in o.material) o.material.roughness = Math.min(0.35, o.material.roughness ?? 0.35);
      }
    });

    this.template = root;
  }

  async spawnBurst(worldPos, upNormal = new THREE.Vector3(0,1,0)) {
    await this._ensureLoaded();
    const coin = this.template.clone(true);
    coin.scale.setScalar(this.scale);
    coin.position.copy(worldPos);

    // 90°-Drehung, leichte Varianz
    coin.rotateY(Math.random() * Math.PI * 2);
    coin.rotateX(Math.PI / 2);

    // leichte Emissive-Variation
    coin.traverse(o => {
      if (o.isMesh && o.material && ('emissiveIntensity' in o.material)) {
        o.material = o.material.clone();
        o.material.emissiveIntensity = (o.material.emissiveIntensity ?? 0.22) * (0.9 + Math.random() * 0.3);
      }
    });

    this.scene.add(coin);

    // Startgeschwindigkeit: nach oben + kleine seitliche Varianz
    const vel = upNormal.clone().multiplyScalar(1.5); // m/s
    vel.x += (Math.random()-0.5) * 0.3;
    vel.z += (Math.random()-0.5) * 0.3;

    const rotSpeed = 8 + Math.random()*4; // rad/s
    this.coins.push({ mesh: coin, vel, rotSpeed, t: 0 });

    // Score +1
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

      // Fade out
      const k = Math.min(1, c.t / LIFETIME);
      const scale = 1 + 0.2 * Math.sin(k * Math.PI);
      c.mesh.scale.setScalar(this.scale * scale);

      c.mesh.traverse(o => {
        if (o.isMesh && o.material && ('emissiveIntensity' in o.material)) {
          o.material.emissiveIntensity = (1 - k) * 0.6;
          if ('opacity' in o.material) {
            o.material.transparent = true;
            o.material.opacity = 1 - k;
          }
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
