import test from "node:test";
import assert from "node:assert/strict";
import { rdToWgs84, solveExifCamera, solvePlanarCamera, solveTwoPointDrawingRegistration, wgs84ToRd } from "../app/cameraMath.ts";

test("recovers situation drawing position, scale and rotation from two points", () => {
  const centerWgs = { lon: 6.426162461, lat: 52.282539407 };
  const centerRd = wgs84ToRd(centerWgs.lon, centerWgs.lat);
  const width = 200;
  const aspect = 2;
  const rotation = 30;
  const theta = rotation * Math.PI / 180;
  const toWorld = ([imageX, imageY]) => {
    const east = (imageX - 0.5) * width;
    const north = (0.5 - imageY) * width / aspect;
    const rotatedEast = east * Math.cos(theta) + north * Math.sin(theta);
    const rotatedNorth = -east * Math.sin(theta) + north * Math.cos(theta);
    const lonLat = rdToWgs84(centerRd[0] + rotatedEast, centerRd[1] + rotatedNorth);
    return { imageX, imageY, lon: lonLat[0], lat: lonLat[1] };
  };
  const solution = solveTwoPointDrawingRegistration(toWorld([0.2, 0.25]), toWorld([0.82, 0.76]), aspect);
  assert.ok(Math.abs(solution.widthMeters - width) < 0.002);
  assert.ok(Math.abs(solution.rotationDegrees - rotation) < 0.002);
  const solvedCenter = wgs84ToRd(solution.center.lon, solution.center.lat);
  assert.ok(Math.hypot(solvedCenter[0] - centerRd[0], solvedCenter[1] - centerRd[1]) < 0.002);
});

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

test("solves an EXIF-only camera pose straight from DJI metadata", () => {
  const site = { lon: 6.426162461, lat: 52.282539407 };
  const origin = wgs84ToRd(site.lon, site.lat);
  const droneWgs = rdToWgs84(origin[0] + 40, origin[1] - 15);
  const solution = solveExifCamera({
    latitude: droneWgs[1], longitude: droneWgs[0],
    relativeAltitude: 70, absoluteAltitude: null,
    gimbalYaw: 0, gimbalPitch: -90, gimbalRoll: 0, flightYaw: null,
    focalLength: 9, focalLength35mm: 24,
    width: 8192, height: 6144,
  }, site.lon, site.lat);
  assert.equal(solution.mode, "exif-metadata");
  assert.ok(Math.abs(solution.cameraLocalRd[0] - 40) < 0.01);
  assert.ok(Math.abs(solution.cameraLocalRd[1] - (-15)) < 0.01);
  assert.equal(solution.cameraLocalRd[2], 70);
  const forward = solution.rotationWorldToCamera[2];
  assert.ok(Math.abs(forward[0]) < 1e-9);
  assert.ok(Math.abs(forward[1]) < 1e-9);
  assert.ok(Math.abs(forward[2] - -1) < 1e-9);
});

test("EXIF camera yaw rotates the forward-facing horizontal view direction", () => {
  const site = { lon: 6.426162461, lat: 52.282539407 };
  const solution = solveExifCamera({
    latitude: site.lat, longitude: site.lon,
    relativeAltitude: 30, absoluteAltitude: null,
    gimbalYaw: 90, gimbalPitch: -45, gimbalRoll: 0, flightYaw: null,
    focalLength: 9, focalLength35mm: 24,
    width: 8192, height: 6144,
  }, site.lon, site.lat);
  const rotation = solution.rotationWorldToCamera;
  const forward = [rotation[0][2], rotation[1][2], rotation[2][2]];
  assert.ok(forward[0] > 0.5, "facing east should have a strong positive east component");
  assert.ok(Math.abs(forward[1]) < 0.1, "facing due east should have ~0 north component");
});
