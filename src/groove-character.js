import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class GrooveCharacterManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.character = null;
    this.mixer = null;
    this.animations = [];
    this.isLoaded = false;
  }

  async ensureLoaded() {
    if (this.isLoaded) return;
    
    try {
      const gltf = await this._load('./assets/groove.glb');
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) throw new Error('groove.glb ohne Szene');

      // Animation Mixer für Animationen
      this.mixer = new THREE.AnimationMixer(root);
      this.animations = gltf.animations || [];

      // Falls Animationen vorhanden sind, die erste starten
      if (this.animations.length > 0) {
        const action = this.mixer.clipAction(this.animations[0]);
        action.play();
      }

      // Charakter-Größe anpassen (falls nötig)
      const bounds = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      bounds.getSize(size);
      
      // Optional: Skalierung basierend auf der Größe
      // root.scale.setScalar(0.5); // Beispiel: halbieren

      this.character = root;
      this.isLoaded = true;
      
    } catch (error) {
      console.error('Fehler beim Laden von groove.glb:', error);
      throw error;
    }
  }

  placeCharacter(viewerPos, viewerQuat) {
    if (!this.character) return;

    // Berechne Position hinter dem vorderen Block, leicht links versetzt
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewerQuat).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(viewerQuat).normalize();
    
    // Position: hinter dem vorderen Block (der bei forward * 1.0 steht)
    // Etwas weiter hinten und leicht links versetzt
    const characterPos = viewerPos.clone()
      .add(forward.clone().multiplyScalar(1.3)) // etwas hinter dem Block
      .add(right.clone().multiplyScalar(-0.3))  // leicht links versetzt
      .add(new THREE.Vector3(0, 0, 0)); // auf dem Boden (y=0 für local-floor)

    this.character.position.copy(characterPos);
    
    // Charakter zum Viewer schauen lassen
    const lookAtPos = new THREE.Vector3(viewerPos.x, characterPos.y, viewerPos.z);
    this.character.lookAt(lookAtPos);

    this.scene.add(this.character);
  }

  update(dtMs) {
    if (this.mixer) {
      const dt = (dtMs ?? 16.666) / 1000;
      this.mixer.update(dt);
    }
  }

  dispose() {
    if (this.character) {
      this.character.removeFromParent();
      this.character.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(mat => mat.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }
    
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    
    this.character = null;
    this.animations = [];
    this.isLoaded = false;
  }

  _load(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }
}