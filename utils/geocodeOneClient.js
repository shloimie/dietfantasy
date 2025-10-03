// utils/geocodeOneClient.js
export async function geocodeOneClient(query) {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const text = await res.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }

    if (!res.ok) {
        const reason = data?.error || data?.detail?.join?.(", ") || text || `HTTP ${res.status}`;
        const e = new Error(reason);
        e.code = res.status;
        e.detail = data?.detail || null;
        throw e;
    }
    if (typeof data?.lat !== "number" || typeof data?.lng !== "number") {
        const e = new Error("Invalid geocode response");
        e.code = "BAD_RESPONSE";
        throw e;
    }
    return {
        lat: data.lat,
        lng: data.lng,
        provider: data?.provider,
        formatted: data?.formatted,
        place_id: data?.place_id,
    };
}

export async function searchGeocodeCandidates(query, limit = 6) {
    const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}&limit=${limit}`, { cache: "no-store" });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Candidate search failed: ${t || res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
}