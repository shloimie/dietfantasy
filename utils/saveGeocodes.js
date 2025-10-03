// utils/saveGeocodes.js
/**
 * updates: Array<{ id: number, lat: number, lng: number }>
 * returns: { results: Array<{ id, ok, reason? }> }
 */
export async function saveGeocodesBulk(updates) {
    const res = await fetch("/api/users/geo/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // IMPORTANT: send an array (not {items}) to match the API above
        body: JSON.stringify(updates),
    });

    if (!res.ok) {
        // If the route was missing earlier, this used to be an HTML 404.
        // Make the error readable:
        const text = await res.text().catch(() => "");
        let reason = `HTTP ${res.status}`;
        try { reason = JSON.parse(text)?.error || reason; } catch {}
        throw new Error(`saveGeocodesBulk failed: ${reason}`);
    }

    const data = await res.json();
    return { results: Array.isArray(data?.results) ? data.results : [] };
}