const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;
const norm360 = (deg) => ((deg % 360) + 360) % 360;

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

  // Crossing angle at the intersection — how "square" the two bearing lines meet.
  // Near 0/180 = unstable fix (lines nearly parallel), near 90 = most stable.
  const crossingAngleDeg = norm360(toDeg(Math.abs(alpha1)));
  const crossingAngleNorm = Math.min(crossingAngleDeg, 180 - crossingAngleDeg > 0 ? crossingAngleDeg : crossingAngleDeg);
  const acute = crossingAngleDeg > 90 ? 180 - crossingAngleDeg : crossingAngleDeg;

  return {
    lat: toDeg(phi3),
    lon: toDeg(lambda3),
    crossingAngleDeg: acute,
    confidence: acute >= 30 ? "good" : acute >= 15 ? "marginal" : "low",
  };
}

// Magnetic declination for Singapore is small (~0.2-0.5°W as of 2026) — close enough to
// ignore for a PoC, but kept as a named constant so it's easy to wire in properly later.
export const SINGAPORE_MAGNETIC_DECLINATION_DEG = 0.3;
