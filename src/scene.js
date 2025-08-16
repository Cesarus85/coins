const THREE_URL = 'https://unpkg.com/three@0.166.1/build/three.module.js';
const { Scene, PerspectiveCamera, WebGLRenderer, HemisphereLight, DirectionalLight, Color } = await import(THREE_URL);

export class SceneRig {
  constructor() {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera();

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    document.body.appendChild(this.renderer.domElement);

    // Lights (subtil, ohne Schatten für AR)
    const hemi = new HemisphereLight(0xffffff, 0x444444, 1.0);
    const dir = new DirectionalLight(0xffffff, 0.6);
    dir.position.set(0.5, 1.0, 0.2);
    this.scene.add(hemi, dir);

    // Hintergrund durchsichtig für Passthrough
    this.renderer.setClearColor(new Color(0x000000), 0);

    // Resize
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
