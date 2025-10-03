// utils/geocodeOneClient.js
export async function geocodeOneClient(query) {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Geocoding failed (${res.status}). ${t || ""}`);
    }
    const data = await res.json();
    if (typeof data?.lat !== "number" || typeof data?.lng !== "number") {
        throw new Error("Invalid geocode response");
    }
    return { lat: data.lat, lng: data.lng, provider: data?.provider, formatted: data?.formatted, place_id: data?.place_id };
}