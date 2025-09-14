// utils/routing/distance.js
// Haversine distance in miles + some helpers. Pure ES module.

const R_MILES = 3958.7613;

const toRad = (d) => (d * Math.PI) / 180;

/**
 * @param {{lat:number,lng:number}} a
 * @param {{lat:number,lng:number}} b
 * @returns {number} miles
 */
export function haversineMiles(a, b) {
    if (!a || !b) return 0;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R_MILES * Math.asin(Math.sqrt(h));
}

export const asPt = (s) => ({ lat: +s.lat, lng: +s.lng });

/**
 * Return centroid of points by simple mean lat/lng.
 * @param {Array<{lat:number,lng:number}>} pts
 * @returns {{lat:number,lng:number}|null}
 */
export function centroid(pts) {
    if (!pts || pts.length === 0) return null;
    let lat = 0,
        lng = 0;
    for (const p of pts) {
        lat += +p.lat;
        lng += +p.lng;
    }
    return { lat: lat / pts.length, lng: lng / pts.length };
}

/**
 * Returns total polyline length in miles.
 * @param {Array<{lat:number,lng:number}>} pts
 */
export function pathMiles(pts) {
    if (!pts || pts.length < 2) return 0;
    let m = 0;
    for (let i = 1; i < pts.length; i++) {
        m += haversineMiles(pts[i - 1], pts[i]);
    }
    return m;
}