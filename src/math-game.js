// ./math-game.js
import * as THREE from 'three';
import { EquationDisplay } from './equation-display.js';

export class MathGame {
  constructor(ui, scene, failManager = null) {
    this.ui = ui;
    this.scene = scene;
    this.failManager = failManager;
    this.blocks = [];
    this.correctIndex = 0;
    this.current = { a: 1, b: 1, sum: 2 };
    this.texCache = new Map();
    this.equationDisplay = new EquationDisplay(scene);
  }

  attachBlocks(blocks, viewerPos = null, viewerQuat = null) {
    this.blocks = blocks || [];
    // Neue separate Anzeigetafeln neben den Blöcken erstellen
    this.blocks.forEach((b, index) => {
      if (!b?.mesh) return;
      if (!b.numberDisplay) {
        b.numberDisplay = this._createNumberDisplay(b.mesh, viewerPos);
        this.scene.add(b.numberDisplay);
      }
    });

    // 3D Gleichungsanzeige erstellen falls Viewer-Position verfügbar
    if (viewerPos && viewerQuat) {
      this.equationDisplay.createDisplay(viewerPos, viewerQuat);
    }

    this._newProblem(true);
  }

  handleHit(blockIndex, hitPosition = null) {
    if (blockIndex == null || !this.blocks[blockIndex]) return false;
    const isCorrect = (blockIndex === this.correctIndex);
    if (isCorrect) {
      this._newProblem(false);
    } else {
      // Falsche Antwort: Spawn Fail-Animation
      if (this.failManager && hitPosition) {
        this.failManager.spawn(hitPosition, new THREE.Vector3(0, 1, 0));
      }
    }
    return isCorrect;
  }

  updateEquationPosition(viewerPos, viewerQuat) {
    this.equationDisplay.updatePosition(viewerPos, viewerQuat);
  }

  dispose() {
    for (const b of this.blocks) {
      if (b?.numberDisplay) {
        b.numberDisplay.traverse(o => {
          if (o.isMesh && o.material?.map) o.material.map.dispose?.();
          if (o.isMesh && o.material) o.material.dispose?.();
          if (o.geometry) o.geometry.dispose?.();
        });
        b.numberDisplay.removeFromParent();
        b.numberDisplay = undefined;
      }
    }
    this.equationDisplay.dispose();
    this.texCache.forEach(tex => tex.dispose?.());
    this.texCache.clear();
  }

  // ---------- intern ----------

  _newProblem(isFirst = false) {
    // a + b, Summe <= 20
    const a = 1 + Math.floor(Math.random() * 10);
    const bMax = Math.min(20 - a, 10);
    const b = 1 + Math.floor(Math.random() * Math.max(1, bMax));
    const sum = a + b;
    this.current = { a, b, sum };
    const equationText = `${a} + ${b} = ?`;
    this.ui?.setEquation?.(equationText);
    this.equationDisplay.updateEquation(equationText);

    // Zufälliger Index für korrekte Antwort
    this.correctIndex = Math.floor(Math.random() * Math.min(4, this.blocks.length));

    // 3 plausible Falschantworten
    const answers = new Set([sum]);
    const candidates = new Set();
    for (const d of [-3,-2,-1,1,2,3,4,-4]) {
      const v = sum + d; if (v >= 0 && v <= 20) candidates.add(v);
    }
    while (candidates.size < 8) candidates.add(Math.floor(Math.random() * 21));
    const wrong = [];
    for (const v of candidates) { if (!answers.has(v)) { wrong.push(v); answers.add(v); } if (wrong.length >= 3) break; }

    // 4 Werte verteilen
    const values = Array(Math.min(4, this.blocks.length)).fill(null);
    if (values.length > 0) values[this.correctIndex] = sum;
    let wi = 0;
    for (let i=0;i<values.length;i++) { if (i !== this.correctIndex) values[i] = wrong[wi++]; }

    // Auf die Blöcke mappen
    for (let i=0;i<values.length;i++) this._setBlockNumber(this.blocks[i], values[i]);
  }

  _createNumberDisplay(blockMesh, viewerPos) {
    const group = new THREE.Group();
    
    // Größe der Anzeigeplatte
    const displaySize = 0.25;
    const geometry = new THREE.PlaneGeometry(displaySize, displaySize * 0.6);
    
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthTest: false,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2000;
    mesh.frustumCulled = false;
    group.add(mesh);

    // Position neben dem Block berechnen
    const blockPos = blockMesh.position.clone();
    
    // Richtung vom Viewer zum Block berechnen
    const toBlock = blockPos.clone().sub(viewerPos || new THREE.Vector3(0, 0, 0)).normalize();
    
    // Seitliche Verschiebung (rechts vom Block aus Sicht des Viewers)
    const right = new THREE.Vector3(0, 1, 0).cross(toBlock).normalize();
    
    // Position der Anzeige: neben dem Block, etwas oberhalb
    const displayPos = blockPos.clone()
      .add(right.multiplyScalar(0.4))  // seitlich versetzt
      .add(new THREE.Vector3(0, 0.2, 0)); // etwas höher
    
    group.position.copy(displayPos);
    
    // Anzeige zum Viewer ausrichten
    if (viewerPos) {
      group.lookAt(viewerPos.clone().add(new THREE.Vector3(0, 0.2, 0)));
    }
    
    return group;
  }

  _setBlockNumber(block, value) {
    if (!block?.numberDisplay) return;
    const text = String(value);
    const tex = this._getOrMakeNumberTexture(text);
    // Nur das erste Mesh in der numberDisplay aktualisieren (das ist unsere Anzeigeplatte)
    const mesh = block.numberDisplay.children[0];
    if (mesh && mesh.isMesh && mesh.material) {
      mesh.material.map = tex;
      mesh.material.needsUpdate = true;
    }
  }

  _getOrMakeNumberTexture(text) {
    if (this.texCache.has(text)) return this.texCache.get(text);
    
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 150;
    const ctx = canvas.getContext('2d');

    // Hintergrund - ähnlich wie bei der Gleichungsanzeige
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    // Text
    ctx.font = 'bold 80px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Schatten
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText(text, canvas.width/2 + 2, canvas.height/2 + 2);

    // Weißer Text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width/2, canvas.height/2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.texCache.set(text, tex);
    return tex;
  }
}
