import proj4 from "proj4";

export type ControlPoint = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  elevation: number;
  imageX: number | null;
  imageY: number | null;
};

export type CameraSolution = {
  mode: "planar-homography" | "exif-metadata";
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

export function solveTwoPointDrawingRegistration(
  first: { imageX: number; imageY: number; lon: number; lat: number },
  second: { imageX: number; imageY: number; lon: number; lat: number },
  drawingAspect: number,
): { center: { lat: number; lon: number }; widthMeters: number; rotationDegrees: number } {
  const firstRd = wgs84ToRd(first.lon, first.lat);
  const secondRd = wgs84ToRd(second.lon, second.lat);
  const mapEast = secondRd[0] - firstRd[0];
  const mapNorth = secondRd[1] - firstRd[1];
  const imageEast = second.imageX - first.imageX;
  const imageNorth = -(second.imageY - first.imageY) / drawingAspect;
  const imageFractionDistance = Math.hypot(imageEast, imageNorth);
  const mapDistance = Math.hypot(mapEast, mapNorth);
  if (imageFractionDistance < 0.03 || mapDistance < 2) throw new Error("De twee registratiepunten liggen te dicht bij elkaar.");
  const mapBearing = Math.atan2(mapEast, mapNorth) * 180 / Math.PI;
  const imageBearing = Math.atan2(imageEast, imageNorth) * 180 / Math.PI;
  const rotationDegrees = ((mapBearing - imageBearing + 540) % 360) - 180;
  const widthMeters = mapDistance / imageFractionDistance;
  const offsetEast = (first.imageX - 0.5) * widthMeters;
  const offsetNorth = (0.5 - first.imageY) * widthMeters / drawingAspect;
  const theta = rotationDegrees * Math.PI / 180;
  const rotatedEast = offsetEast * Math.cos(theta) + offsetNorth * Math.sin(theta);
  const rotatedNorth = -offsetEast * Math.sin(theta) + offsetNorth * Math.cos(theta);
  const centerLonLat = rdToWgs84(firstRd[0] - rotatedEast, firstRd[1] - rotatedNorth);
  return { center: { lat: centerLonLat[1], lon: centerLonLat[0] }, widthMeters, rotationDegrees };
}

function solveLinear(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const augmented = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) throw new Error("De gekozen punten leveren geen stabiele oplossing op.");
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = column; j <= n; j += 1) augmented[column][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= n; j += 1) augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row) => row[n]);
}

function leastSquares(rows: number[][], values: number[]): number[] {
  const columns = rows[0].length;
  const normal = Array.from({ length: columns }, () => Array(columns).fill(0));
  const rhs = Array(columns).fill(0);
  for (let i = 0; i < rows.length; i += 1) {
    for (let a = 0; a < columns; a += 1) {
      rhs[a] += rows[i][a] * values[i];
      for (let b = 0; b < columns; b += 1) normal[a][b] += rows[i][a] * rows[i][b];
    }
  }
  return solveLinear(normal, rhs);
}

function norm(v: number[]) { return Math.hypot(...v); }
function scale(v: number[], value: number) { return v.map((item) => item * value); }
function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v: number[]) { const length = norm(v); return scale(v, 1 / length); }
function dot(a: number[], b: number[]) { return a.reduce((sum, value, i) => sum + value * b[i], 0); }

export function solvePlanarCamera(points: ControlPoint[], siteLon: number, siteLat: number, imageWidth: number, imageHeight: number, focalLength35mm: number, focalLengthMm: number): CameraSolution {
  const complete = points.filter((point) => point.imageX != null && point.imageY != null);
  if (complete.length < 6) throw new Error("Koppel minimaal zes punten op kaart en foto voor een controleerbare oplossing.");
  const elevations = complete.map((point) => point.elevation);
  const groundElevation = elevations.reduce((sum, value) => sum + value, 0) / elevations.length;
  if (Math.max(...elevations) - Math.min(...elevations) > 0.25) throw new Error("Deze eerste solver gebruikt één vlak terreinpeil. Houd de peilen gelijk of gebruik straks de 3D-solver.");
  const siteRd = wgs84ToRd(siteLon, siteLat);
  const rows: number[][] = [];
  const values: number[] = [];
  const local = complete.map((point) => {
    const rd = wgs84ToRd(point.lon, point.lat);
    return { ...point, x: rd[0] - siteRd[0], y: rd[1] - siteRd[1] };
  });
  for (const point of local) {
    const { x, y } = point;
    const u = point.imageX as number;
    const v = point.imageY as number;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]); values.push(v);
  }
  const h = leastSquares(rows, values);
  const H = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const fx = (focalLength35mm / 36) * imageWidth;
  const fy = fx;
  const cx = imageWidth / 2;
  const cy = imageHeight / 2;
  const kinv = (column: number[]) => [(column[0] - cx * column[2]) / fx, (column[1] - cy * column[2]) / fy, column[2]];
  const b1 = kinv([H[0][0], H[1][0], H[2][0]]);
  const b2 = kinv([H[0][1], H[1][1], H[2][1]]);
  const b3 = kinv([H[0][2], H[1][2], H[2][2]]);
  let lambda = 2 / (norm(b1) + norm(b2));
  let r1 = normalize(scale(b1, lambda));
  const r2raw = scale(b2, lambda);
  let r2 = normalize(r2raw.map((value, i) => value - dot(r2raw, r1) * r1[i]));
  let r3 = normalize(cross(r1, r2));
  let t = scale(b3, lambda) as [number, number, number];
  const centerFor = () => [-dot(r1, t), -dot(r2, t), -dot(r3, t)];
  let center = centerFor();
  if (center[2] < 0) {
    lambda *= -1;
    r1 = scale(r1, -1); r2 = scale(r2, -1); r3 = normalize(cross(r1, r2));
    t = scale(b3, lambda) as [number, number, number];
    center = centerFor();
  }
  const rotation = [[r1[0], r2[0], r3[0]], [r1[1], r2[1], r3[1]], [r1[2], r2[2], r3[2]]];
  const errors = local.map((point) => {
    const denominator = H[2][0] * point.x + H[2][1] * point.y + H[2][2];
    const u = (H[0][0] * point.x + H[0][1] * point.y + H[0][2]) / denominator;
    const v = (H[1][0] * point.x + H[1][1] * point.y + H[1][2]) / denominator;
    return { id: point.id, errorPixels: Math.hypot(u - (point.imageX as number), v - (point.imageY as number)) };
  });
  const rms = Math.sqrt(errors.reduce((sum, point) => sum + point.errorPixels ** 2, 0) / errors.length);
  return {
    mode: "planar-homography", rmsPixels: rms, maxErrorPixels: Math.max(...errors.map((point) => point.errorPixels)),
    focalPixels: fx, principalPoint: [cx, cy], sensorWidthMm: focalLengthMm * 36 / focalLength35mm, groundElevationNap: groundElevation, homography: H,
    rotationWorldToCamera: rotation, translationWorldToCamera: t, cameraLocalRd: center as [number, number, number],
    cameraRd: [siteRd[0] + center[0], siteRd[1] + center[1], groundElevation + center[2]], pointErrors: errors,
  };
}

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
