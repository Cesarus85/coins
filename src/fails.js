// ./fails.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class FailManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.template = null;
    this.pool = [];
    this.active = [];
    this._preloadPromise = null;
  }

  async preload() {
    if (this._preloadPromise) return this._preloadPromise;
    this._preloadPromise = new Promise((resolve) => {
      this.loader.load('./assets/fail.glb', (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) { resolve(); return; }
        root.traverse(o => {
          if (o.isMesh && o.material) {
            if ('emissive' in o.material) o.material.emissive.set(0x990000);
            if ('emissiveIntensity' in o.material) o.material.emissiveIntensity = 0.8;
            o.material.toneMapped = false;
          }
        });
        this.template = root;
        for (let i=0;i<6;i++) this._return(this._makeInstance());
        resolve();
      }, undefined, () => resolve());
    });
    return this._preloadPromise;
  }

  _makeInstance() {
    const mesh = this.template.clone(true);
    mesh.scale.setScalar(0.18); // kleiner
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, t: 0 };
  }
  _return(inst) { inst.mesh.visible = false; this.pool.push(inst); }

  spawn(pos, upNormal) {
    if (!this.template) return;
    const inst = this.pool.pop() || this._makeInstance();
    inst.t = 0;
    inst.mesh.position.copy(pos).addScaledVector(upNormal ?? new THREE.Vector3(0,1,0), 0.08);
    inst.mesh.quaternion.set(0,0,0,1);
    inst.mesh.visible = true;
    this.active.push(inst);
  }

  update(dtMs) {
    const dt = dtMs / 1000;
    for (let i=this.active.length-1;i>=0;i--) {
      const fx = this.active[i];
      fx.t += dt;
      fx.mesh.position.y += dt * 0.35;
      const alpha = Math.max(0, 1 - fx.t / 1.0);
      fx.mesh.traverse(o => {
        if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = alpha; }
      });
      if (fx.t > 1.0) this._return(this.active.splice(i,1)[0]);
    }
  }

  dispose() {
    this.active.forEach(inst => inst.mesh.removeFromParent());
    this.pool.forEach(inst => inst.mesh.removeFromParent());
    this.active.length = this.pool.length = 0;
    this.template = null;
  }
}
