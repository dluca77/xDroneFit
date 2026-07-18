import test from "node:test";
import assert from "node:assert/strict";
import { rdToWgs84, solvePlanarCamera, wgs84ToRd } from "../app/cameraMath.ts";

test("recovers a known camera pose from six planar control points", () => {
  const site = { lon: 6.426162461, lat: 52.282539407 };
  const origin = wgs84ToRd(site.lon, site.lat);
  const expectedCenter = [20, -60, 65];
  const focalPixels = (24 / 36) * 8192;
  const target = [0, 0, 0];
  const forward = target.map((value, index) => value - expectedCenter[index]);
  const forwardLength = Math.hypot(...forward);
  forward.forEach((_, index) => { forward[index] /= forwardLength; });
  const right = [forward[1], -forward[0], 0];
  const rightLength = Math.hypot(...right);
  right.forEach((_, index) => { right[index] /= rightLength; });
  const down = [forward[1] * right[2] - forward[2] * right[1], forward[2] * right[0] - forward[0] * right[2], forward[0] * right[1] - forward[1] * right[0]];
  const rotation = [right, down, forward];
  const translation = rotation.map((row) => -row.reduce((sum, value, index) => sum + value * expectedCenter[index], 0));
  const points = [[-25, -20], [25, -20], [35, 25], [-30, 30], [0, 0], [18, 12]].map(([x, y], index) => {
    const lonLat = rdToWgs84(origin[0] + x, origin[1] + y);
    const camera = rotation.map((row, rowIndex) => row[0] * x + row[1] * y + translation[rowIndex]);
    return { id: String(index), label: `P${index + 1}`, lon: lonLat[0], lat: lonLat[1], elevation: 0, imageX: focalPixels * camera[0] / camera[2] + 4096, imageY: focalPixels * camera[1] / camera[2] + 3072 };
  });
  const solution = solvePlanarCamera(points, site.lon, site.lat, 8192, 6144, 24, 9);
  assert.ok(solution.rmsPixels < 0.001);
  solution.cameraLocalRd.forEach((value, index) => assert.ok(Math.abs(value - expectedCenter[index]) < 0.002));
});

