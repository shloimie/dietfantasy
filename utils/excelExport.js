import * as XLSX from "xlsx";

export function exportExcel(orderedUsers, tsString) {
    const finalData = orderedUsers.map((u) => {
        const s = u.schedule || {};
        return {
            FIRST: u.first ?? "",
            LAST: u.last ?? "",
            ADDRESS: u.address ?? "",
            APT: u.apt ?? "",
            CITY: u.city ?? "",
            DISLIKES: u.dislikes ?? "",
            COUNTY: u.county ?? "",
            ZIP: u.zip ?? "",
            STATE: u.state ?? "",
            PHONE: u.phone ?? "",
            MEDICAID: u.medicaid ? "Yes" : "No",
            PAUSED: u.paused ? "Yes" : "No",
            COMPLEX: u.complex ? "Yes" : "No",
            MON: s.monday ? "Y" : "",
            TUE: s.tuesday ? "Y" : "",
            WED: s.wednesday ? "Y" : "",
            THU: s.thursday ? "Y" : "",
            FRI: s.friday ? "Y" : "",
            SAT: s.saturday ? "Y" : "",
            SUN: s.sunday ? "Y" : "",
        };
    });
    const worksheet = XLSX.utils.json_to_sheet(finalData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Users");
    XLSX.writeFile(workbook, `master ${tsString()}.xlsx`);
}