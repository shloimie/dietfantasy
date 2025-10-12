// utils/geocoders/google.js
// Server-side Google Geocoding helper (backup/fallback). US-biased, robust parsing.

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export function normalizeAddress(q) {
    return String(q || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[.,]+/g, ".")
        .replace(/\bunited states\b|\bus\b/g, "")
        .trim();
}

// Turn a user into a single address string
export function formatAddress(u) {
    const line1 = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
    const cityStZip = [u.city, u.state, u.zip].filter(Boolean).join(" ");
    return [line1, cityStZip].filter(Boolean).join(", ");
}

// Parse Google result -> {lat,lng, city,state,zip}
function parseResult(result) {
    const loc = result?.geometry?.location;
    const comps = result?.address_components || [];
    const pick = (type) =>
        comps.find((c) => c.types?.includes(type))?.short_name ||
        comps.find((c) => c.types?.includes(type))?.long_name;

    return {
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
        city: pick("locality") || pick("sublocality") || pick("postal_town") || null,
        state: pick("administrative_area_level_1") || null,
        zip: pick("postal_code") || null,
    };
}

// One address -> Google Geocode
export async function geocodeWithGoogle(addr, bias = {}) {
    if (!addr) return { ok: false, reason: "empty-address" };

    const params = new URLSearchParams({
        address: addr,
        key: process.env.GOOGLE_MAPS_API_KEY || "",
    });

    // Prefer U.S. results unless told otherwise
    if (bias.region) params.set("region", bias.region);
    if (!bias.region && (bias.country || bias.state || bias.postal_code)) {
        // 'region' is coarse; components are stronger filters.
        const comps = [];
        if (bias.country) comps.push(`country:${bias.country}`);
        if (bias.state) comps.push(`administrative_area:${bias.state}`);
        if (bias.postal_code) comps.push(`postal_code:${bias.postal_code}`);
        if (comps.length) params.set("components", comps.join("|"));
    }

    // (Optional) Restrict result types to street addresses to avoid place POIs
    // params.set("result_type", "street_address|premise|subpremise");

    // Bias language for consistency
    if (bias.language) params.set("language", bias.language);

    const url = `${GOOGLE_GEOCODE_URL}?${params.toString()}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };

    const data = await res.json();
    if (data.status !== "OK" || !data.results?.length) {
        return { ok: false, reason: data.status || "no-results" };
    }

    const best = data.results[0];
    const parsed = parseResult(best);
    if (parsed.lat == null || parsed.lng == null) return { ok: false, reason: "no-geometry" };

    return {
        ok: true,
        ...parsed,
        raw: best,
    };
}