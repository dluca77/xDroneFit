import test from "node:test";
import assert from "node:assert/strict";
import { rdToWgs84, solveExifCamera, solveVanishingPointCamera, wgs84ToRd } from "../app/cameraMath.ts";

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

test("recovers a known camera rotation and focal length from two vanishing points", () => {
  const site = { lon: 6.426162461, lat: 52.282539407 };
  // A hand-built orthonormal rotation matrix (not axis-aligned, to exercise the general case).
  const yaw = 22 * Math.PI / 180, pitch = -52 * Math.PI / 180, roll = 6 * Math.PI / 180;
  const right = [Math.cos(yaw), -Math.sin(yaw), 0];
  const forward = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
  const downRaw = [
    forward[1] * right[2] - forward[2] * right[1],
    forward[2] * right[0] - forward[0] * right[2],
    forward[0] * right[1] - forward[1] * right[0],
  ];
  const downLen = Math.hypot(...downRaw);
  const down = downRaw.map((v) => v / downLen);
  const cosR = Math.cos(roll), sinR = Math.sin(roll);
  const r1 = right.map((v, i) => v * cosR + down[i] * sinR);
  const r2 = down.map((v, i) => v * cosR - right[i] * sinR);
  const r3 = forward;
  const R = [[r1[0], r2[0], r3[0]], [r1[1], r2[1], r3[1]], [r1[2], r2[2], r3[2]]];
  const [d1, d2] = R;
  const focalPixels = 1400;
  const cx = 4096, cy = 3072;
  const vpFrom = (d) => ({ x: cx + (focalPixels * d[0]) / d[2], y: cy + (focalPixels * d[1]) / d[2] });
  const vp1 = vpFrom(d1);
  const vp2 = vpFrom(d2);
  const along = (vp, dx, dy, t) => ({ x: vp.x + dx * t, y: vp.y + dy * t });
  const group1 = [along(vp1, 1, 0.3, -400), along(vp1, 1, 0.3, 400), along(vp1, -1, 0.7, -250), along(vp1, -1, 0.7, 300)];
  const group2 = [along(vp2, 0.4, 1, -350), along(vp2, 0.4, 1, 500), along(vp2, -0.6, 1, -200), along(vp2, -0.6, 1, 280)];
  const solution = solveVanishingPointCamera(
    group1, group2, 8192, 6144,
    { latitude: site.lat, longitude: site.lon, relativeAltitude: 40 },
    site.lon, site.lat,
  );
  assert.equal(solution.mode, "vanishing-points");
  assert.ok(Math.abs(solution.focalPixels - focalPixels) < 0.01, `focalPixels off: ${solution.focalPixels}`);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      assert.ok(Math.abs(solution.rotationWorldToCamera[i][j] - R[i][j]) < 1e-6, `rotation[${i}][${j}] off`);
    }
  }
  assert.equal(solution.cameraLocalRd[2], 40);
});

test("rejects two vanishing-point directions that are not roughly perpendicular", () => {
  assert.throws(() => solveVanishingPointCamera(
    [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 300 }, { x: 200, y: 300 }],
    [{ x: 100, y: 100 }, { x: 200, y: 105 }, { x: 100, y: 300 }, { x: 200, y: 305 }],
    8192, 6144, { latitude: 52.28, longitude: 6.42, relativeAltitude: 40 }, 6.42, 52.28,
  ));
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
