// utils/excelExport.js
import * as XLSX from "xlsx";

/** Fallback timestamp helper (MM-DD H:MMAM) */
function localTsString() {
    const d = new Date();
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${mm}-${dd} ${h}:${String(m).padStart(2, "0")}${ampm}`;
}

/**
 * Export a COMPLETE backup of user rows to XLSX.
 * - Includes all Prisma fields from `User` model.
 * - Adds a few derived helpers (FULL_NAME, FULL_ADDRESS).
 * - Accepts either a tsString() function OR a ready-made timestamp string.
 *
 * @param {Array<Object>} users
 * @param {Function|string} [ts]  If function, called to get timestamp; if string, used directly; otherwise uses local fallback.
 */
export function exportExcel(users = [], ts) {
    const rows = Array.isArray(users) ? users : [];

    // Normalize timestamp input
    const timestamp =
        typeof ts === "function" ? ts() :
            (typeof ts === "string" && ts) ? ts :
                localTsString();

    // Column order (header)
    const HEADERS = [
        "ID",
        "FIRST",
        "LAST",
        "FULL_NAME",
        "ADDRESS",
        "APT",
        "CITY",
        "STATE",
        "ZIP",
        "COUNTY",
        "PHONE",
        "DISLIKES",
        "MEDICAID",
        "PAUSED",
        "COMPLEX",
        "LAT",           // normalized lat (prefers u.lat, falls back to u.latitude)
        "LNG",           // normalized lng (prefers u.lng, falls back to u.longitude)
        "LATITUDE",      // raw DB latitude
        "LONGITUDE",     // raw DB longitude
        "GEOCODED_AT",
        "SIGN_TOKEN",
        "CREATED_AT",
        "UPDATED_AT",
        // Schedule flags
        "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
        // Raw JSON columns for lossless backup
        "SCHEDULE_JSON",
        "VISITS_JSON",
        // Nice-to-have deriveds
        "FULL_ADDRESS",
    ];

    const table = rows.map((u) => {
        const s = u?.schedule || {};
        const lat = u?.lat ?? u?.latitude ?? null;
        const lng = u?.lng ?? u?.longitude ?? null;

        const first = u?.first ?? "";
        const last  = u?.last ?? "";
        const name  = `${first} ${last}`.trim();

        const addr1 = `${u?.address ?? ""}`.trim();
        const apt   = u?.apt ?? "";
        const fullAddressLine = [addr1, apt].filter(Boolean).join(" ").trim();
        const cityStateZip = [u?.city ?? "", u?.state ?? "", u?.zip ?? ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        const fullAddress = [fullAddressLine, cityStateZip].filter(Boolean).join(", ");

        // Stringify JSON safely
        const scheduleJson = (() => {
            try { return JSON.stringify(s ?? {}, null, 0); } catch { return ""; }
        })();
        const visitsJson = (() => {
            try { return JSON.stringify(u?.visits ?? [], null, 0); } catch { return ""; }
        })();

        // ISO dates
        const iso = (d) => {
            try {
                const dt = d ? new Date(d) : null;
                return dt && !isNaN(+dt) ? dt.toISOString() : "";
            } catch { return ""; }
        };

        return {
            ID: u?.id ?? "",
            FIRST: first,
            LAST: last,
            FULL_NAME: name,
            ADDRESS: addr1,
            APT: apt,
            CITY: u?.city ?? "",
            STATE: u?.state ?? "",
            ZIP: u?.zip ?? "",
            COUNTY: u?.county ?? "",
            PHONE: u?.phone ?? "",
            DISLIKES: u?.dislikes ?? "",
            MEDICAID: u?.medicaid ? "Yes" : "No",
            PAUSED: u?.paused ? "Yes" : "No",
            COMPLEX: u?.complex ? "Yes" : "No",
            LAT: lat ?? "",
            LNG: lng ?? "",
            LATITUDE: u?.latitude ?? "",
            LONGITUDE: u?.longitude ?? "",
            GEOCODED_AT: iso(u?.geocodedAt),
            SIGN_TOKEN: u?.sign_token ?? "",
            CREATED_AT: iso(u?.createdAt),
            UPDATED_AT: iso(u?.updatedAt),

            // Weekly flags (upper-case short)
            MON: s?.monday ? "Y" : "",
            TUE: s?.tuesday ? "Y" : "",
            WED: s?.wednesday ? "Y" : "",
            THU: s?.thursday ? "Y" : "",
            FRI: s?.friday ? "Y" : "",
            SAT: s?.saturday ? "Y" : "",
            SUN: s?.sunday ? "Y" : "",

            // Raw JSON for perfect round-trip if needed
            SCHEDULE_JSON: scheduleJson,
            VISITS_JSON: visitsJson,

            // Derived
            FULL_ADDRESS: fullAddress,
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(table, { header: HEADERS });
    // Optional: set some sensible column widths
    worksheet["!cols"] = [
        { wch: 6 },   // ID
        { wch: 14 },  // FIRST
        { wch: 16 },  // LAST
        { wch: 24 },  // FULL_NAME
        { wch: 28 },  // ADDRESS
        { wch: 10 },  // APT
        { wch: 16 },  // CITY
        { wch: 8 },   // STATE
        { wch: 10 },  // ZIP
        { wch: 16 },  // COUNTY
        { wch: 16 },  // PHONE
        { wch: 24 },  // DISLIKES
        { wch: 10 },  // MEDICAID
        { wch: 8 },   // PAUSED
        { wch: 8 },   // COMPLEX
        { wch: 12 },  // LAT
        { wch: 12 },  // LNG
        { wch: 12 },  // LATITUDE
        { wch: 12 },  // LONGITUDE
        { wch: 22 },  // GEOCODED_AT
        { wch: 22 },  // SIGN_TOKEN
        { wch: 22 },  // CREATED_AT
        { wch: 22 },  // UPDATED_AT
        { wch: 4 },   // MON
        { wch: 4 },   // TUE
        { wch: 4 },   // WED
        { wch: 4 },   // THU
        { wch: 4 },   // FRI
        { wch: 4 },   // SAT
        { wch: 4 },   // SUN
        { wch: 30 },  // SCHEDULE_JSON
        { wch: 30 },  // VISITS_JSON
        { wch: 34 },  // FULL_ADDRESS
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Users");
    XLSX.writeFile(workbook, `users-backup ${timestamp}.xlsx`);
}