// lib/geocode.ts
export type GeoResult = { lat: number | null; lng: number | null };

function buildQuery(addr?: string, apt?: string, city?: string, state?: string, zip?: string) {
    const parts = [addr, apt, city, state, zip].filter(Boolean);
    return parts.join(", ");
}

export async function geocodeIfNeeded(
    {
        address, apt, city, state, zip,
        latitude, longitude,
    }: {
        address?: string | null;
        apt?: string | null;
        city?: string | null;
        state?: string | null;
        zip?: string | null;
        latitude?: number | null;
        longitude?: number | null;
    },
    force = false
): Promise<GeoResult> {
    // Skip if we already have coords and not forcing
    if (!force && latitude != null && longitude != null) {
        return { lat: latitude, lng: longitude };
    }

    const q = buildQuery(address ?? "", apt ?? "", city ?? "", state ?? "", zip ?? "");
    if (!q.trim()) return { lat: null, lng: null };

    const which = (process.env.GEOCODER || "mapbox").toLowerCase();

    try {
        if (which === "google" && process.env.GOOGLE_MAPS_API_KEY) {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`google ${res.status}`);
            const data = await res.json();
            const loc = data?.results?.[0]?.geometry?.location;
            return loc ? { lat: loc.lat, lng: loc.lng } : { lat: null, lng: null };
        }

        // default: mapbox
        const token = process.env.MAPBOX_TOKEN;
        if (!token) return { lat: null, lng: null };
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&limit=1`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`mapbox ${res.status}`);
        const data = await res.json();
        const c = data?.features?.[0]?.center;
        return Array.isArray(c) && c.length >= 2 ? { lat: c[1], lng: c[0] } : { lat: null, lng: null };
    } catch {
        return { lat: null, lng: null };
    }
}