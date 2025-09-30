// utils/excelExport.js
import * as XLSX from "xlsx";

/** Local, self-contained timestamp helper */
function tsString() {
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
 * Export the provided users array to an .xlsx file (one sheet).
 * The function is deliberately self-contained: it computes its own timestamp and
 * does not rely on any external tsString().
 */
export default function exportExcel(users = []) {
    const rows = Array.isArray(users) ? users : [];
    // Turn raw user objects into a flat table
    const table = rows.map((u) => ({
        First: u.first ?? "",
        Last: u.last ?? "",
        Address: `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
        City: u.city ?? "",
        State: u.state ?? "",
        Zip: u.zip ?? "",
        Phone: u.phone ?? "",
        Paused: !!u.paused,
        Lat: u.lat ?? u.latitude ?? "",
        Lng: u.lng ?? u.longitude ?? "",
        Monday: !!u?.schedule?.monday,
        Tuesday: !!u?.schedule?.tuesday,
        Wednesday: !!u?.schedule?.wednesday,
        Thursday: !!u?.schedule?.thursday,
        Friday: !!u?.schedule?.friday,
        Saturday: !!u?.schedule?.saturday,
        Sunday: !!u?.schedule?.sunday,
    }));

    const worksheet = XLSX.utils.json_to_sheet(table);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Users");
    XLSX.writeFile(workbook, `master ${tsString()}.xlsx`);
}