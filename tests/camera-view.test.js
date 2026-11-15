import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CubeView } from '../src/cube-view.js';

function fixture(width, height, framingDistance = 7) {
  const view = Object.create(CubeView.prototype);
  Object.assign(view, {
    camera: new THREE.PerspectiveCamera(34, width / height, 0.1, 80),
    cube: new THREE.Group(), velocity: { x: 0.1, y: 0.1 },
    framingDistance, reducedMotion: false, schedule() {},
  });
  view.resetView();
  view.cube.quaternion.copy(view.orientationTween.to);
  return view;
}

test('the angled starting view zooms closer while keeping every corner inside the screen', () => {
  const geometry = new THREE.BoxGeometry(2.048, 2.048, 2.048);
  for (const [width, height] of [[320, 568], [412, 844], [844, 412], [768, 1024], [1440, 900], [2560, 1080]]) {
    for (const framingDistance of [7, 6.4]) {
      const view = fixture(width, height, framingDistance);
      view.camera.updateMatrixWorld();
      assert(view.camera.position.z < framingDistance / Math.min(width / height, 1), 'start closer than the original view');
      const angle = new THREE.Euler().setFromQuaternion(view.cube.quaternion, 'XYZ');
      assert(Math.abs(angle.x - 0.4) < 1e-6 && Math.abs(angle.y + 0.55) < 1e-6 && Math.abs(angle.z + 0.025) < 1e-6);
      for (let index = 0; index < geometry.attributes.position.count; index++) {
        const corner = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, index)
          .applyQuaternion(view.cube.quaternion).project(view.camera);
        assert(Math.abs(corner.x) <= 0.900001 && Math.abs(corner.y) <= 0.900001,
          `corner clipped at ${width} x ${height}`);
      }
    }
  }
  geometry.dispose();
});

test('manual zoom survives resizing and Center restores the fitted angled view', () => {
  const view = fixture(412, 844);
  const initialDistance = view.camera.position.z;
  view.zoom = 1.5;
  view.updateCamera();
  assert(Math.abs(view.camera.position.z * 1.5 - initialDistance) < 1e-6);
  view.camera.aspect = 844 / 412;
  view.updateCamera();
  assert.equal(view.zoom, 1.5);
  const zoomedDistance = view.camera.position.z;
  view.rotateBy(0.2, 0.1);
  assert.equal(view.orientationTween, null);
  view.resetView();
  assert.equal(view.zoom, 1);
  assert(Math.abs(view.camera.position.z - zoomedDistance * 1.5) < 1e-6);
  assert.equal(view.velocity.x + view.velocity.y, 0);
  assert(view.orientationTween.from.angleTo(view.orientationTween.to) > 0.1);
});
