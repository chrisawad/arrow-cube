import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CubeView } from '../src/cube-view.js';

function fixture() {
  const handlers = new Map(), selected = [];
  const view = Object.create(CubeView.prototype);
  Object.assign(view, {
    canvas: { style: {}, focus() {}, setPointerCapture() {},
      addEventListener(type, handler) { handlers.set(type, handler); } },
    events: new AbortController(), pointers: new Map(), velocity: { x: 0, y: 0 },
    zoom: 1, cube: new THREE.Group(), schedule() {}, updateCamera() {},
    onInteract() {}, onSelect: (...args) => selected.push(args),
    pickMove: () => ({ id: 17, reverse: false }),
  });
  view.bindInput();
  return { view, selected,
    send(type, id, x, y) {
      handlers.get(type)({ type, pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch' });
    } };
}
const close = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('a two-finger clockwise twist turns the cube in screen space while pinching zooms', () => {
  const h = fixture();
  h.send('pointerdown', 1, 100, 100);
  h.send('pointerdown', 2, 200, 100);
  h.send('pointermove', 2, 100, 250);
  close(h.view.zoom, 1.5);
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(h.view.cube.quaternion);
  close(axis.x, 0); close(axis.y, -1); close(axis.z, 0);
  h.send('pointerup', 2, 100, 250);
  h.send('pointerup', 1, 100, 100);
  h.send('click', 1, 100, 100);
  assert.deepEqual(h.selected, [], 'a two-finger gesture never releases an arrow');
  close(h.view.velocity.x + h.view.velocity.y, 0);
});

test('twisting across the angle boundary is a small rotation and cannot flip the cube', () => {
  const h = fixture();
  h.send('pointerdown', 1, 100, 100);
  h.send('pointerdown', 2, 0, 101);
  h.send('pointermove', 2, 0, 99);
  close(h.view.cube.quaternion.angleTo(new THREE.Quaternion()), 2 * Math.atan(0.01));
  close(h.view.zoom, 1);
});

test('changing the active finger pair keeps zoom and orientation continuous', () => {
  const h = fixture();
  h.send('pointerdown', 1, 0, 0);
  h.send('pointerdown', 2, 100, 0);
  h.send('pointerdown', 3, 300, 0);
  h.send('pointerup', 2, 100, 0);
  h.send('pointermove', 3, 301, 0);
  close(h.view.zoom, 301 / 300);
  close(h.view.cube.quaternion.angleTo(new THREE.Quaternion()), 0);
  h.send('pointercancel', 3, 301, 0);
  h.send('pointermove', 1, 2, 0);
  assert(h.view.cube.quaternion.angleTo(new THREE.Quaternion()) > 0, 'the remaining finger can resume normal rotation');
  h.send('pointerup', 1, 2, 0);
  assert.deepEqual(h.selected, []);
  assert.equal(h.view.pointers.size, 0);
});

test('nearly touching fingers do not cause a twist and canceled capture never selects an arrow', () => {
  const h = fixture();
  h.send('pointerdown', 1, 100, 100);
  h.send('pointerdown', 2, 106, 100);
  h.send('pointermove', 2, 94, 100);
  close(h.view.cube.quaternion.angleTo(new THREE.Quaternion()), 0);
  h.send('lostpointercapture', 2, 94, 100);
  h.send('pointerup', 1, 100, 100);
  h.send('click', 1, 100, 100);
  assert.deepEqual(h.selected, []);
});

test('a single tap still selects an arrow, and ordinary dragging still rotates', () => {
  const h = fixture();
  h.send('pointerdown', 1, 100, 100);
  h.send('pointerup', 1, 100, 100);
  assert.deepEqual(h.selected, [], 'pointerup cannot open a modal before the browser targets its click');
  h.send('lostpointercapture', 1, 100, 100);
  h.send('click', 1, 100, 100);
  assert.deepEqual(h.selected, [[17, false]]);
  h.send('click', 1, 100, 100);
  assert.equal(h.selected.length, 1, 'one tap cannot activate an arrow twice');
  h.send('pointerdown', 1, 100, 100);
  h.send('pointermove', 1, 130, 125);
  h.send('pointerup', 1, 130, 125);
  h.send('click', 1, 130, 125);
  assert.equal(h.selected.length, 1);
  assert(h.view.cube.quaternion.angleTo(new THREE.Quaternion()) > 0);
});
