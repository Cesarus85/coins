import * as THREE from 'three';

export class SceneRig {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    document.body.appendChild(this.renderer.domElement);

    // HELLERE LICHTER für AR
    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1.15);
    const dir  = new THREE.DirectionalLight(0xffffff, 1.05);
    dir.position.set(0.5, 1.0, 0.2);
    this.scene.add(ambient, hemi, dir);

    this.renderer.setClearColor(new THREE.Color(0x000000), 0);

    this._onResize = () => this.renderer.setSize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', this._onResize);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer?.dispose();
    this.scene?.traverse(obj => {
      if (obj.material?.dispose) obj.material.dispose();
      if (obj.geometry?.dispose) obj.geometry.dispose();
    });
    this.renderer?.domElement?.remove();
  }
}
