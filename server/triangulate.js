const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;
const norm360 = (deg) => ((deg % 360) + 360) % 360;

const EARTH_RADIUS_KM = 6371;
// Generous upper bound for a naked-eye/camera drone sighting — anything further than this
// cannot be a real fix and means the bearings didn't actually converge nearby.
const MAX_PLAUSIBLE_SIGHTING_RANGE_KM = 30;

const haversineKm = (a, b) => {
  const phi1 = toRad(a.lat), phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat), dLambda = toRad(b.lon - a.lon);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

// Intersection of two great-circle paths, each defined by a start point + bearing.
// Standard formula: https://www.movable-type.co.uk/scripts/latlong.html#intersection
// Returns null if the two bearings are parallel or diverge (no real intersection).
export function intersectBearings(p1, brng1Deg, p2, brng2Deg) {
  const phi1 = toRad(p1.lat), lambda1 = toRad(p1.lon);
  const phi2 = toRad(p2.lat), lambda2 = toRad(p2.lon);
  const theta13 = toRad(brng1Deg), theta23 = toRad(brng2Deg);
  const dPhi = phi2 - phi1, dLambda = lambda2 - lambda1;

  const delta12 = 2 * Math.asin(Math.sqrt(
    Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  ));
  if (Math.abs(delta12) < 1e-12) return null; // same point

  const cosThetaA = (Math.sin(phi2) - Math.sin(phi1) * Math.cos(delta12)) / (Math.sin(delta12) * Math.cos(phi1));
  const cosThetaB = (Math.sin(phi1) - Math.sin(phi2) * Math.cos(delta12)) / (Math.sin(delta12) * Math.cos(phi2));
  const thetaA = Math.acos(Math.min(1, Math.max(-1, cosThetaA)));
  const thetaB = Math.acos(Math.min(1, Math.max(-1, cosThetaB)));

  let theta12, theta21;
  if (Math.sin(dLambda) > 0) {
    theta12 = thetaA;
    theta21 = 2 * Math.PI - thetaB;
  } else {
    theta12 = 2 * Math.PI - thetaA;
    theta21 = thetaB;
  }

  const alpha1 = theta13 - theta12;
  const alpha2 = theta21 - theta23;

  if (Math.sin(alpha1) === 0 && Math.sin(alpha2) === 0) return null; // infinite intersections (same line)
  if (Math.sin(alpha1) * Math.sin(alpha2) < 0) return null; // bearings diverge, intersect "behind" one observer

  const cosAlpha3 = -Math.cos(alpha1) * Math.cos(alpha2) + Math.sin(alpha1) * Math.sin(alpha2) * Math.cos(delta12);
  const alpha3 = Math.acos(Math.min(1, Math.max(-1, cosAlpha3)));
  const delta13 = Math.atan2(
    Math.sin(delta12) * Math.sin(alpha1) * Math.sin(alpha2),
    Math.cos(alpha2) + Math.cos(alpha1) * cosAlpha3
  );
  const phi3 = Math.asin(Math.min(1, Math.max(-1,
    Math.sin(phi1) * Math.cos(delta13) + Math.cos(phi1) * Math.sin(delta13) * Math.cos(theta13)
  )));
  const dLambda13 = Math.atan2(
    Math.sin(theta13) * Math.sin(delta13) * Math.cos(phi1),
    Math.cos(delta13) - Math.sin(phi1) * Math.sin(phi3)
  );
  const lambda3 = lambda1 + dLambda13;

  const fixLat = toDeg(phi3);
  const fixLon = toDeg(lambda3);
  const fixPoint = { lat: fixLat, lon: fixLon };

  // Sanity check: two great circles always cross at two points, exactly antipodal to
  // each other on the globe. When the reported bearings don't actually converge on a
  // real nearby point (noisy compass readings, or observers not looking at the same
  // target), this formula can pick the far-side intersection instead of failing —
  // which surfaces as a "fix" ~20,000km away (e.g. off the coast of Colombia for a
  // sighting in Tampines). Reject anything outside a plausible sighting range instead.
  if (haversineKm(p1, fixPoint) > MAX_PLAUSIBLE_SIGHTING_RANGE_KM ||
      haversineKm(p2, fixPoint) > MAX_PLAUSIBLE_SIGHTING_RANGE_KM) {
    return null;
  }

  // Crossing angle at the intersection — how "square" the two bearing lines meet.
  // Near 0/180 = unstable fix (lines nearly parallel), near 90 = most stable.
  const crossingAngleDeg = norm360(toDeg(Math.abs(alpha1)));
  const acute = crossingAngleDeg > 90 ? 180 - crossingAngleDeg : crossingAngleDeg;

  return {
    lat: fixLat,
    lon: fixLon,
    crossingAngleDeg: acute,
    confidence: acute >= 30 ? "good" : acute >= 15 ? "marginal" : "low",
  };
}

// Magnetic declination for Singapore is small (~0.2-0.5°W as of 2026) — close enough to
// ignore for a PoC, but kept as a named constant so it's easy to wire in properly later.
export const SINGAPORE_MAGNETIC_DECLINATION_DEG = 0.3;
