import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACE_BASIS } from './cube-surface.js';

const WIDTH = 0.0425; // Slightly slimmer while retaining a bold, readable band.
// The whole band stays beneath the 1.021 arrow planes, including its round
// caps. A raised tube left a yellow lip beyond the lines in face-on views.
export const YELLOW_EDGE_EXTENT = 1.020 - WIDTH;
const EXTENT = YELLOW_EDGE_EXTENT;
const CORNER = 0.10; // Keep the wider band's inner corner smooth and shallow.

/** Smooth connected yellow corners and cap isolated ends, in cube coordinates. */
export function yellowEdgeGeometries(edges) {
  const vertices = new Map();
  const vertex = point => {
    const key = point.toArray().join(',');
    if (!vertices.has(key)) vertices.set(key, { point, links: [] });
    return vertices.get(key);
  };
  const segments = edges.map(([a, b], index) => {
    const fixed = FACE_BASIS[a].normal.map((value, i) => value + FACE_BASIS[b].normal[i]);
    const start = vertex(new THREE.Vector3(...fixed.map(value => value || -1)).multiplyScalar(EXTENT));
    const end = vertex(new THREE.Vector3(...fixed.map(value => value || 1)).multiplyScalar(EXTENT));
    start.links.push({ index, other: end }); end.links.push({ index, other: start });
    return { start, end, pieces: [] };
  });
  const trim = (from, to) => from.point.clone().addScaledVector(
    to.point.clone().sub(from.point).normalize(), from.links.length === 2 ? CORNER : 0);
  for (const segment of segments) {
    const from = trim(segment.start, segment.end), to = trim(segment.end, segment.start);
    segment.pieces.push(new THREE.TubeGeometry(new THREE.LineCurve3(from, to), 1, WIDTH, 16, false));
  }
  for (const node of vertices.values()) {
    const pieces = segments[node.links[0].index].pieces;
    if (node.links.length === 2) {
      const from = trim(node, node.links[0].other), to = trim(node, node.links[1].other);
      // Tangents match the straight portions on either side of the cube corner.
      const bend = new THREE.QuadraticBezierCurve3(from, node.point, to);
      pieces.push(new THREE.TubeGeometry(bend, 12, WIDTH, 16, false));
    } else {
      // Rounded end caps also close three-way junctions without open tube rims.
      pieces.push(new THREE.SphereGeometry(WIDTH, 16, 12).translate(...node.point.toArray()));
    }
  }
  return segments.map(({ pieces }) => {
    const geometry = mergeGeometries(pieces);
    for (const piece of pieces) piece.dispose();
    return geometry;
  });
}
