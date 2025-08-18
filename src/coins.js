import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const COIN_DIAMETER = 0.14;
const GRAVITY = -3.8;
const LIFETIME = 1.2;
const COIN_SPAWN_LIFT = 0.12;

// Pool-Größe (gleichzeitig sichtbare Coins). Kannst du erhöhen, falls nötig.
const POOL_SIZE = 16;

export class CoinManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null;
    this.scale = 1;

    // Pool & aktive Liste
    this.pool = [];     // { mesh, mats:Material[] }
    this.active = [];   // { mesh, mats, vel:Vector3, rotSpeed:number, t:number }

    this.score = 0;
  }

  async ensureLoaded() {
    if (this.template && this.pool.length) return;
    await this._loadTemplate();
    this._buildPool(); // einmalig erstellen
  }

  async _loadTemplate() {
    const gltf = await this._load('./assets/coin.glb');
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('coin.glb ohne Szene');

    // Auto-Scale
    const bounds = new THREE.Box3().setFromObject(root);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const srcDiameter = (isFinite(sphere.radius) && sphere.radius > 0) ? sphere.radius * 2 : 1;
    this.scale = COIN_DIAMETER / srcDiameter;

    // Basis-Material leicht heller (einmalig am Template)
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

  _buildPool() {
    // bereits gebaut?
    if (this.pool.length) return;

    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = this.template.clone(true);
      mesh.scale.setScalar(this.scale);
      mesh.visible = false;

      // Pro Instanz eigene Material-Klone sammeln (für Fade/Opacity)
      const mats = [];
      mesh.traverse(o => {
        if (o.isMesh && o.material) {
          if (Array.isArray(o.material)) {
            o.material = o.material.map(m => m.clone());
            mats.push(...o.material);
          } else {
            o.material = o.material.clone();
            mats.push(o.material);
          }
          if ('opacity' in o.material) { o.material.transparent = true; o.material.opacity = 1.0; }
        }
      });

      this.scene.add(mesh);
      this.pool.push({ mesh, mats });
    }
  }

  _borrow() {
    if (this.pool.length) return this.pool.pop();
    // Fallback: falls Pool voll → älteste aktive zurücksetzen (ring buffer)
    const fallback = this.active.shift();
    if (fallback) {
      fallback.mesh.visible = false;
      return { mesh: fallback.mesh, mats: fallback.mats };
    }
    return null;
  }

  _return(inst) {
    inst.mesh.visible = false;
    this.pool.push(inst);
  }

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
    if (!this.template || !this.pool.length) {
      await this.ensureLoaded();
    }
    const inst = this._borrow();
    if (!inst) return;

    const { mesh, mats } = inst;

    // Reset & Position
    mesh.visible = true;
    mesh.position.copy(worldPos).addScaledVector(upNormal, COIN_SPAWN_LIFT);
    mesh.rotation.set(0, 0, 0);
    mesh.rotateY(Math.random() * Math.PI * 2);
    mesh.rotateX(Math.PI / 2);
    mesh.scale.setScalar(this.scale);

    // Reset Materialien (Opacity/Emissive)
    for (const m of mats) {
      if ('opacity' in m) m.opacity = 1.0;
      if ('emissiveIntensity' in m) m.emissiveIntensity = 0.8;
    }

    const vel = upNormal.clone().multiplyScalar(1.4);
    vel.x += (Math.random() - 0.5) * 0.08;
    vel.z += (Math.random() - 0.5) * 0.08;
    const rotSpeed = 9 + Math.random() * 3;

    this.active.push({ mesh, mats, vel, rotSpeed, t: 0 });
    this.score += 1;
  }

  update(dtMs) {
    const dt = (dtMs ?? 16.666) / 1000;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      c.t += dt;

      c.vel.y += GRAVITY * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotateY(c.rotSpeed * dt);

      const k = Math.min(1, c.t / LIFETIME);
      const scale = 1 + 0.25 * Math.sin(k * Math.PI);
      c.mesh.scale.setScalar(this.scale * scale);

      const opacity = 1 - k;
      const emissive = (1 - k) * 0.8;
      for (const m of c.mats) {
        if ('opacity' in m) m.opacity = opacity;
        if ('emissiveIntensity' in m) m.emissiveIntensity = emissive;
      }

      if (c.t >= LIFETIME) {
        // zurück in den Pool
        const inst = { mesh: c.mesh, mats: c.mats };
        this.active.splice(i, 1);
        this._return(inst);
      }
    }
  }

  _load(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }
}
