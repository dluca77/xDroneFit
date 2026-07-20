import proj4 from "proj4";

export type CameraSolution = {
  mode: "exif-metadata" | "vanishing-points";
  rmsPixels: number;
  maxErrorPixels: number;
  focalPixels: number;
  principalPoint: [number, number];
  sensorWidthMm: number;
  groundElevationNap: number;
  homography: number[][];
  rotationWorldToCamera: number[][];
  translationWorldToCamera: [number, number, number];
  cameraLocalRd: [number, number, number];
  cameraRd: [number, number, number];
  pointErrors: Array<{ id: string; errorPixels: number }>;
};

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";
const RD_NEW = "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.4171,50.3319,465.5524,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs";

export function wgs84ToRd(lon: number, lat: number): [number, number] {
  const result = proj4(WGS84, RD_NEW, [lon, lat]);
  return [result[0], result[1]];
}

export function rdToWgs84(x: number, y: number): [number, number] {
  const result = proj4(RD_NEW, WGS84, [x, y]);
  return [result[0], result[1]];
}

function norm(v: number[]) { return Math.hypot(...v); }
function scale(v: number[], value: number) { return v.map((item) => item * value); }
function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v: number[]) { const length = norm(v); return scale(v, 1 / length); }
function dot(a: number[], b: number[]) { return a.reduce((sum, value, i) => sum + value * b[i], 0); }

export type DroneExif = {
  latitude: number; longitude: number;
  relativeAltitude: number | null; absoluteAltitude: number | null;
  gimbalYaw: number | null; gimbalPitch: number | null; gimbalRoll: number | null; flightYaw: number | null;
  focalLength: number | null; focalLength35mm: number | null;
  width: number; height: number;
};

export function solveExifCamera(drone: DroneExif, siteLon: number, siteLat: number): CameraSolution {
  const yaw = ((drone.gimbalYaw ?? drone.flightYaw ?? 0) * Math.PI) / 180;
  const pitch = ((drone.gimbalPitch ?? -45) * Math.PI) / 180;
  const roll = ((drone.gimbalRoll ?? 0) * Math.PI) / 180;
  const altitude = drone.relativeAltitude ?? 30;
  const focal35 = drone.focalLength35mm ?? 24;
  const right = [Math.cos(yaw), -Math.sin(yaw), 0];
  const forward = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
  const down = normalize(cross(forward, right));
  const r1 = right.map((value, i) => value * Math.cos(roll) + down[i] * Math.sin(roll));
  const r2 = down.map((value, i) => value * Math.cos(roll) - right[i] * Math.sin(roll));
  const r3 = forward;
  const rotation = [[r1[0], r2[0], r3[0]], [r1[1], r2[1], r3[1]], [r1[2], r2[2], r3[2]]];
  const siteRd = wgs84ToRd(siteLon, siteLat);
  const droneRd = wgs84ToRd(drone.longitude, drone.latitude);
  const local: [number, number, number] = [droneRd[0] - siteRd[0], droneRd[1] - siteRd[1], altitude];
  const fx = (focal35 / 36) * drone.width;
  return {
    mode: "exif-metadata", rmsPixels: 0, maxErrorPixels: 0,
    focalPixels: fx, principalPoint: [drone.width / 2, drone.height / 2],
    sensorWidthMm: drone.focalLength && focal35 ? (drone.focalLength * 36) / focal35 : 36,
    groundElevationNap: 0, homography: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    rotationWorldToCamera: rotation, translationWorldToCamera: [0, 0, 0], cameraLocalRd: local,
    cameraRd: [siteRd[0] + local[0], siteRd[1] + local[1], local[2]], pointErrors: [],
  };
}

export type ImagePoint = { x: number; y: number };
export type VanishingLineGroup = [ImagePoint, ImagePoint, ImagePoint, ImagePoint];

export function intersectLines(a1: ImagePoint, a2: ImagePoint, b1: ImagePoint, b2: ImagePoint): ImagePoint {
  const denom = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(denom) < 1e-9) throw new Error("Deze twee lijnen zijn (bijna) evenwijdig en kruisen elkaar niet. Kies duidelijker convergerende lijnen.");
  const crossA = a1.x * a2.y - a1.y * a2.x;
  const crossB = b1.x * b2.y - b1.y * b2.x;
  return {
    x: (crossA * (b1.x - b2.x) - (a1.x - a2.x) * crossB) / denom,
    y: (crossA * (b1.y - b2.y) - (a1.y - a2.y) * crossB) / denom,
  };
}

export function solveVanishingPointCamera(
  group1: VanishingLineGroup,
  group2: VanishingLineGroup,
  imageWidth: number,
  imageHeight: number,
  drone: { latitude: number; longitude: number; relativeAltitude: number | null },
  siteLon: number,
  siteLat: number,
): CameraSolution {
  const vp1 = intersectLines(group1[0], group1[1], group1[2], group1[3]);
  const vp2 = intersectLines(group2[0], group2[1], group2[2], group2[3]);
  const cx = imageWidth / 2;
  const cy = imageHeight / 2;
  const u1 = vp1.x - cx, v1 = vp1.y - cy;
  const u2 = vp2.x - cx, v2 = vp2.y - cy;
  const dotUV = u1 * u2 + v1 * v2;
  if (dotUV >= 0) throw new Error("Deze twee richtingen lijken niet loodrecht op elkaar te staan. Controleer de lijnen en kies echt haakse randen.");
  const focalPixels = Math.sqrt(-dotUV);
  const d1 = normalize([u1, v1, focalPixels]);
  const d2raw = [u2, v2, focalPixels];
  const d2 = normalize(d2raw.map((value, i) => value - dot(d2raw, d1) * d1[i]));
  const d3 = normalize(cross(d1, d2));
  const rotation = [d1, d2, d3];
  const siteRd = wgs84ToRd(siteLon, siteLat);
  const droneRd = wgs84ToRd(drone.longitude, drone.latitude);
  const altitude = drone.relativeAltitude ?? 30;
  const local: [number, number, number] = [droneRd[0] - siteRd[0], droneRd[1] - siteRd[1], altitude];
  const sensorWidthMm = 36;
  return {
    mode: "vanishing-points", rmsPixels: 0, maxErrorPixels: 0,
    focalPixels, principalPoint: [cx, cy], sensorWidthMm,
    groundElevationNap: 0, homography: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    rotationWorldToCamera: rotation, translationWorldToCamera: [0, 0, 0], cameraLocalRd: local,
    cameraRd: [siteRd[0] + local[0], siteRd[1] + local[1], local[2]], pointErrors: [],
  };
}
