// utils/routing/mileage.js
// Total miles along a route (sum of leg distances) using helpers from distance.js

import { pathMiles } from "./distance.js";

/**
 * routeMiles(stops)
 * stops: array of user/stop objects that may use lat/lng OR latitude/longitude
 * Returns total miles along the route in the given order.
 */
export function routeMiles(stops = []) {
    const pts = (stops || [])
        .map((s) => ({
            lat: Number(s?.lat ?? s?.latitude),
            lng: Number(s?.lng ?? s?.longitude),
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    if (pts.length < 2) return 0;
    return pathMiles(pts);
}

export default routeMiles;