// utils/routing/candidates.js

function normalizeDay(selectedDay) {
    const raw = String(selectedDay || "all").toLowerCase().trim();
    if (raw === "all" || raw === "all days" || raw === "alldays") return null;
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    return days.includes(raw) ? raw : null;
}

/** Filter users that are active + (optionally) on the selected day + geocoded */
export function getGeocodedCandidates(users, selectedDay = "all") {
    const dayKey = normalizeDay(selectedDay);
    return (users || []).filter(u => {
        if (u?.paused) return false;
        const lat = u?.lat ?? u?.latitude;
        const lng = u?.lng ?? u?.longitude;
        if (lat == null || lng == null) return false;
        if (!dayKey) return true;
        return Boolean(u?.schedule?.[dayKey]);
    }).map(u => ({
        ...u,
        lat: u.lat ?? u.latitude,
        lng: u.lng ?? u.longitude,
    }));
}