const THREE_URL = 'https://unpkg.com/three@0.166.1/build/three.module.js';
const { Vector3 } = await import(THREE_URL);

// Liefert Interaktionssphären von Controllern & Händen.
export function getInteractionSpheres(frame, refSpace, inputSources) {
  const spheres = [];
  const tmp = new Vector3();

  for (const input of inputSources) {
    // Controller (Grip bevorzugt, sonst TargetRay)
    if (input.gripSpace) {
      const pose = frame.getPose(input.gripSpace, refSpace);
      if (pose) {
        spheres.push({
          center: new Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z),
          radius: 0.08
        });
      }
    } else if (input.targetRaySpace) {
      const pose = frame.getPose(input.targetRaySpace, refSpace);
      if (pose) {
        spheres.push({
          center: new Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z),
          radius: 0.06
        });
      }
    }

    // Hand-Tracking: Index-Fingerspitze + Handfläche
    if (input.hand) {
      const tip = input.hand.get('index-finger-tip');
      const palm = input.hand.get('wrist'); // Approximation als Zentrum

      if (tip) {
        const tipPose = frame.getJointPose(tip, refSpace);
        if (tipPose) {
          spheres.push({
            center: new Vector3(tipPose.transform.position.x, tipPose.transform.position.y, tipPose.transform.position.z),
            radius: Math.max(0.015, tipPose.radius ?? 0.01)
          });
        }
      }
      if (palm) {
        const palmPose = frame.getJointPose(palm, refSpace);
        if (palmPose) {
          spheres.push({
            center: new Vector3(palmPose.transform.position.x, palmPose.transform.position.y, palmPose.transform.position.z),
            radius: 0.06
          });
        }
      }
    }
  }
  return spheres;
}
