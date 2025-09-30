// utils/driversWord.js
// Word (.docx) export (two columns, one page per driver, colored).
// After saving the .docx, ALSO generates a route-ordered, driver-colored labels PDF
// using the NEW utils/pdfRouteLabels.js (does NOT touch your original labels export).

import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    PageOrientation,
} from "docx";
import { saveAs } from "file-saver";

import { MIN_PER_MILE, MIN_PER_STOP } from "./routing";
import { planRoutesBalancedByMilesArrays } from "./routing";
import { routeMiles } from "./routing/mileage";

// *** NEW import: separate labels generator (keeps original labels module intact)
import { exportRouteLabelsPDF } from "./pdfRouteLabels";

function tsString() {
    const d = new Date();
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return `${mm}-${dd} ${h}:${String(m).padStart(2, "0")}${ampm}`;
}
function normalizeDay(selectedDay) {
    const raw = String(selectedDay || "all").toLowerCase().trim();
    if (raw === "all" || raw === "all days" || raw === "alldays") return null;
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    return days.includes(raw) ? raw : null;
}

const MARGIN = 720;   // ~0.5"
const COL_GAP = 720;  // ~0.5"
const COL_COUNT = 2;

const DEFAULT_COLORS = [
    "#1677FF", "#52C41A", "#FA8C16", "#EB2F96", "#13C2C2",
    "#F5222D", "#722ED1", "#A0D911", "#2F54EB", "#FAAD14",
    "#73D13D", "#36CFC9",
];
const hexToDocx = (hex) => (hex || "#000000").replace(/^#/, "").toUpperCase();

function hmm(mins) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}:${String(m).padStart(2, "0")}`;
}
function estMinutesFromRoute(stops) {
    const miles = routeMiles(stops);
    const stopsCount = stops.length;
    return miles * MIN_PER_MILE + stopsCount * MIN_PER_STOP;
}

function buildDriverSection(stops, index, dayTitle, colorHex) {
    const color = hexToDocx(colorHex || DEFAULT_COLORS[index % DEFAULT_COLORS.length]);
    const miles = routeMiles(stops);
    const stopsCount = stops.length;
    const estMin = Math.round(miles * MIN_PER_MILE + stopsCount * MIN_PER_STOP);

    const children = [];

    children.push(new Paragraph({
        children: [ new TextRun({ text: `Driver ${index + 1} — ${dayTitle}`, bold: true, size: 30, color }) ],
        spacing: { after: 200 },
    }));
    children.push(new Paragraph({
        children: [
            new TextRun({ text: "Stops: ", bold: true }),
            new TextRun({ text: String(stopsCount), color }),
            new TextRun({ text: "   |   Miles: ", bold: true }),
            new TextRun({ text: miles.toFixed(1), color }),
            new TextRun({ text: "   |   Est Time: ", bold: true }),
            new TextRun({ text: hmm(estMin), color }),
            new TextRun({ text: `   ( ${MIN_PER_MILE} min/mi, ${MIN_PER_STOP} min/stop )`, italics: true }),
        ],
        spacing: { after: 200 },
    }));

    if (!stopsCount) {
        children.push(new Paragraph("(No assigned stops)"));
    } else {
        stops.forEach((u, i) => {
            const name = `${u.first ?? ""} ${u.last ?? ""}`.trim() || "Customer";
            const addr1 = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
            const addr2 = `${u.city ?? ""}`.trim();
            const phone = u.phone || u.phone1 || u.phone2 || "";

            children.push(new Paragraph({
                children: [
                    new TextRun({ text: `${i + 1}. `, bold: true, color }),
                    new TextRun({ text: name, bold: true }),
                ],
            }));
            if (addr1) children.push(new Paragraph(addr1));
            if (addr2) children.push(new Paragraph(addr2));
            if (phone) children.push(new Paragraph(phone));
            children.push(new Paragraph({ text: "", spacing: { after: 140 } }));
        });

        children.push(new Paragraph({
            children: [
                new TextRun({ text: "Total: ", bold: true }),
                new TextRun({ text: `${miles.toFixed(1)} mi`, color }),
                new TextRun({ text: `   |   Stops: `, bold: true }),
                new TextRun({ text: String(stopsCount), color }),
                new TextRun({ text: `   |   Est Time: `, bold: true }),
                new TextRun({ text: hmm(estMin), color }),
            ],
            spacing: { before: 200 },
        }));
    }

    return {
        properties: {
            page: {
                size: { orientation: PageOrientation.PORTRAIT },
                margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
            },
            column: { count: COL_COUNT, space: COL_GAP, equalWidth: true },
        },
        children,
    };
}

export async function exportDriversWord(users, selectedDay, driverCount, opts = {}) {
    const { driverColors } = opts; // optional exact map palette (hex array)

    const k = Math.max(1, Number(driverCount || 0));
    const dayKey = normalizeDay(selectedDay);
    const list = Array.isArray(users) ? users : [];

    const active = list.filter((u) => !u?.paused && (dayKey ? Boolean(u?.schedule?.[dayKey]) : true));
    const geocoded = active
        .filter((u) => (u?.lat ?? u?.latitude) != null && (u?.lng ?? u?.longitude) != null)
        .map((u) => ({ ...u, lat: u.lat ?? u.latitude, lng: u.lng ?? u.longitude }));

    const routes = planRoutesBalancedByMilesArrays(geocoded, k);
    const dayTitle = dayKey ? selectedDay : "All Days";

    const sections = routes.map((stops, i) =>
        buildDriverSection(stops, i, dayTitle, driverColors?.[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length])
    );

    const doc = new Document({
        creator: "Diet Fantasy",
        description: "Driver routes",
        title: `Drivers — ${dayTitle} — ${tsString()}`,
        sections,
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `drivers ${tsString()}.docx`);

    // ALSO produce route-ordered, driver-colored labels (separate, ADD-ON flow)
    try {
        await exportRouteLabelsPDF(routes, driverColors, tsString);
    } catch (e) {
        console.warn("Route-ordered labels export failed:", e);
    }
}

export default exportDriversWord;