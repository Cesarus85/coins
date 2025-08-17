import * as THREE from 'three';

// Liefert Interaktionssphären von Controllern & Händen.
export function getInteractionSpheres(frame, refSpace, inputSources) {
  const spheres = [];

  for (const input of inputSources) {
    // Controller (Grip bevorzugt)
    if (input.gripSpace) {
      const pose = frame.getPose(input.gripSpace, refSpace);
      if (pose) {
        spheres.push({
          center: new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z),
          radius: 0.08
        });
      }
    } else if (input.targetRaySpace) {
      const pose = frame.getPose(input.targetRaySpace, refSpace);
      if (pose) {
        spheres.push({
          center: new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z),
          radius: 0.06
        });
      }
    }

    // Hand-Tracking (optional)
    if (input.hand) {
      const tip = input.hand.get('index-finger-tip');
      const knuckle = input.hand.get('wrist');
      if (tip) {
        const tipPose = frame.getJointPose(tip, refSpace);
        if (tipPose) {
          spheres.push({
            center: new THREE.Vector3(tipPose.transform.position.x, tipPose.transform.position.y, tipPose.transform.position.z),
            radius: Math.max(0.015, tipPose.radius ?? 0.01)
          });
        }
      }
      if (knuckle) {
        const kPose = frame.getJointPose(knuckle, refSpace);
        if (kPose) {
          spheres.push({
            center: new THREE.Vector3(kPose.transform.position.x, kPose.transform.position.y, kPose.transform.position.z),
            radius: 0.06
          });
        }
      }
    }
  }
  return spheres;
}
