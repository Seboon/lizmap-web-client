/**
 * @module modules/measures/Geodesy.js
 * @name Geodesy
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

// Computations on the WGS84 ellipsoid, used by the measure tools (as QGIS
// Desktop, which measures on the ellipsoid by default).

const A = 6378137;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const E2 = F * (2 - F);
const E = Math.sqrt(E2);

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Normalizes an angle in degrees into [0, 360).
 * @param {number} deg - Angle
 * @returns {number} Angle in [0, 360)
 */
export function normalizeDegrees(deg) {
    const value = deg % 360;

    return value < 0 ? value + 360 : value;
}

/**
 * Initial bearing on a sphere, used when Vincenty's method does not
 * converge (nearly antipodal points).
 * @param {number[]} p1 - [lon, lat] in degrees
 * @param {number[]} p2 - [lon, lat] in degrees
 * @returns {{distance: number, azimuth: number}} Distance (m) and azimuth (degrees)
 */
function sphericalInverse(p1, p2) {
    const phi1 = toRad(p1[1]);
    const phi2 = toRad(p2[1]);
    const dLambda = toRad(p2[0] - p1[0]);
    const R = 6371008.8;

    const h = Math.sin((phi2 - phi1) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    const distance = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

    return { distance, azimuth: normalizeDegrees(toDeg(Math.atan2(y, x))) };
}

/**
 * Distance and initial azimuth between two points on the WGS84
 * ellipsoid (Vincenty's inverse method, accurate to less than a
 * millimetre).
 * @param {number[]} p1 - [lon, lat] in degrees
 * @param {number[]} p2 - [lon, lat] in degrees
 * @returns {{distance: number, azimuth: number}} Distance (m) and azimuth from the north, clockwise (degrees)
 */
export function inverse(p1, p2) {
    if (p1[0] === p2[0] && p1[1] === p2[1]) {
        return { distance: 0, azimuth: 0 };
    }

    const L = toRad(p2[0] - p1[0]);
    const U1 = Math.atan((1 - F) * Math.tan(toRad(p1[1])));
    const U2 = Math.atan((1 - F) * Math.tan(toRad(p2[1])));
    const sinU1 = Math.sin(U1);
    const cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2);
    const cosU2 = Math.cos(U2);

    let lambda = L;
    let sinLambda;
    let cosLambda;
    let sinSigma;
    let cosSigma;
    let sigma;
    let cosSqAlpha;
    let cos2SigmaM;
    let iterations = 0;
    let lambdaP;

    do {
        sinLambda = Math.sin(lambda);
        cosLambda = Math.cos(lambda);
        sinSigma = Math.sqrt(
            (cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
        );

        if (sinSigma === 0) {
            return { distance: 0, azimuth: 0 };
        }

        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
        sigma = Math.atan2(sinSigma, cosSigma);

        const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;

        cosSqAlpha = 1 - sinAlpha * sinAlpha;
        cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha : 0;

        const C = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));

        lambdaP = lambda;
        lambda = L + (1 - C) * F * sinAlpha
            * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    } while (Math.abs(lambda - lambdaP) > 1e-12 && ++iterations < 200);

    if (iterations >= 200) {
        return sphericalInverse(p1, p2);
    }

    const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
    const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const deltaSigma = bigB * sinSigma * (cos2SigmaM + (bigB / 4)
        * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)
        - (bigB / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));

    const distance = B * bigA * (sigma - deltaSigma);
    const azimuth = Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);

    return { distance, azimuth: normalizeDegrees(toDeg(azimuth)) };
}

/**
 * The "q" function of the authalic latitude.
 * @param {number} sinPhi - Sine of the geodetic latitude
 * @returns {number} q
 */
function authalicQ(sinPhi) {
    const es = E * sinPhi;

    return (1 - E2) * (sinPhi / (1 - es * es) - (1 / (2 * E)) * Math.log((1 - es) / (1 + es)));
}

const QP = authalicQ(1);

// Radius of the sphere with the same area as the ellipsoid.
const AUTHALIC_RADIUS = A * Math.sqrt(QP / 2);

/**
 * Area of a polygon on the WGS84 ellipsoid. The latitudes are converted
 * into authalic latitudes, which maps the ellipsoid onto a sphere of the
 * same area without changing any area; the area is then computed on that
 * sphere (edges: great circles, which differ from the geodesics by a
 * negligible amount at the scale of a map measure).
 * @param {number[][][]} rings - Rings of [lon, lat] in degrees (the first one is the outer ring)
 * @returns {number} Area (m²)
 */
export function polygonArea(rings) {
    const ringArea = (ring) => {
        const coords = ring.map(([lon, lat]) => [lon, toDeg(Math.asin(authalicQ(Math.sin(toRad(lat))) / QP))]);
        const len = coords.length;
        let area = 0;
        let [x1, y1] = coords[len - 1];

        for (let i = 0; i < len; i++) {
            const [x2, y2] = coords[i];

            area += toRad(x2 - x1) * (2 + Math.sin(toRad(y1)) + Math.sin(toRad(y2)));
            x1 = x2;
            y1 = y2;
        }

        return Math.abs((area * AUTHALIC_RADIUS * AUTHALIC_RADIUS) / 2);
    };

    return rings.reduce((total, ring, index) => total + (index === 0 ? 1 : -1) * ringArea(ring), 0);
}

/**
 * The projection is a metric one other than Pseudo-Mercator (e.g.
 * Lambert-93): lengths can be measured directly in its coordinates.
 * Pseudo-Mercator is left out: its distances are strongly stretched away
 * from the equator.
 * @param {object} projection - OpenLayers projection
 * @returns {boolean} True for a metric projection other than Pseudo-Mercator
 */
export function isMetricProjection(projection) {
    const code = projection.getCode();

    return projection.getUnits() === 'm' && code !== 'EPSG:3857' && code !== 'EPSG:900913';
}
