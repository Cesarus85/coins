// ./equation-display.js
import * as THREE from 'three';

export class EquationDisplay {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.texCache = new Map();
    this._currentText = '';
  }

  createDisplay(viewerPos, viewerQuat) {
    if (this.mesh) return;

    // Position vor dem Spieler, am unteren Sichtfeldrand aber gut lesbar
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewerQuat);
    const position = viewerPos.clone()
      .add(forward.multiplyScalar(0.8))
      .add(new THREE.Vector3(0, -0.2, 0));

    // Plane für die Gleichung
    const geometry = new THREE.PlaneGeometry(0.6, 0.15);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthTest: false,
      depthWrite: false
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.lookAt(viewerPos);
    this.mesh.renderOrder = 2000;
    this.mesh.frustumCulled = false;
    
    this.scene.add(this.mesh);
    
    // Erste Gleichung anzeigen falls vorhanden
    if (this._currentText) {
      this.updateEquation(this._currentText);
    }
  }

  updateEquation(text) {
    this._currentText = text;
    if (!this.mesh) return;

    const texture = this._getOrMakeEquationTexture(text);
    this.mesh.material.map = texture;
    this.mesh.material.needsUpdate = true;
  }

  updatePosition(viewerPos, viewerQuat) {
    if (!this.mesh) return;

    // Gleichung folgt dem Spieler in einem sanften Bogen
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewerQuat);
    const targetPos = viewerPos.clone()
      .add(forward.multiplyScalar(0.8))
      .add(new THREE.Vector3(0, -0.2, 0));

    // Sanfte Interpolation zur neuen Position
    this.mesh.position.lerp(targetPos, 0.05);
    this.mesh.lookAt(viewerPos.clone().add(new THREE.Vector3(0, -0.2, 0)));
  }

  dispose() {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry?.dispose();
      this.mesh.material?.dispose();
      this.mesh = null;
    }
    this.texCache.forEach(tex => tex.dispose?.());
    this.texCache.clear();
  }

  _getOrMakeEquationTexture(text) {
    if (this.texCache.has(text)) return this.texCache.get(text);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Hintergrund
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    // Text
    ctx.font = 'bold 64px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Schatten
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText(text, canvas.width/2 + 2, canvas.height/2 + 2);

    // Weißer Text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width/2, canvas.height/2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    
    this.texCache.set(text, texture);
    return texture;
  }
}