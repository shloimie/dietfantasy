// utils/driversWord.js
// Word (.docx) export with two columns, one page per driver, and per-driver totals.
// Computes routes internally (Option B).
//
// Install once:
//   npm i docx file-saver
//
// Usage (Option B):
//   import { exportDriversWord } from "../utils/driversWord";
//   await exportDriversWord(users, selectedDay, driverCount);

import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    PageOrientation,
} from "docx";
import { saveAs } from "file-saver";

// Pull planning + constants from your routing barrel
import {
    planRoutesBalancedByMilesArrays,
    MIN_PER_MILE,
    MIN_PER_STOP,
} from "./routing";

// Miles along a route using your normalized helper
import { routeMiles } from "./routing/mileage";

// ---- internal timestamp (no external import needed) ----
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

// ---- day helper (same semantics as your PDF) ----
function normalizeDay(selectedDay) {
    const raw = String(selectedDay || "all").toLowerCase().trim();
    if (raw === "all" || raw === "all days" || raw === "alldays") return null;
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    return days.includes(raw) ? raw : null;
}

// ---- Word layout constants ----
const MARGIN = 720;  // ~0.5"
const COL_GAP = 720; // ~0.5"
const COL_COUNT = 2;

// Format minutes -> h:mm
function hmm(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}:${String(m).padStart(2, "0")}`;
}

// Build a single driver section (two columns)
function buildDriverSection(stops, index, dayTitle) {
    const miles = routeMiles(stops);
    const stopsCount = stops.length;
    const estMin = Math.round(miles * MIN_PER_MILE + stopsCount * MIN_PER_STOP);

    const children = [];

    // Heading
    children.push(
        new Paragraph({
            text: `Driver ${index + 1} — ${dayTitle}`,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 200 },
        })
    );

    // Summary line
    children.push(
        new Paragraph({
            children: [
                new TextRun(`Stops: ${stopsCount}  |  Miles: ${miles.toFixed(1)}  |  Est Time: ${hmm(estMin)}  `),
                new TextRun({ text: `( ${MIN_PER_MILE} min/mi, ${MIN_PER_STOP} min/stop )`, italics: true }),
            ],
            spacing: { after: 200 },
        })
    );

    if (!stopsCount) {
        children.push(new Paragraph("(No assigned stops)"));
    } else {
        stops.forEach((u, i) => {
            const name = `${u.first ?? ""} ${u.last ?? ""}`.trim() || "Customer";
            const addr1 = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
            const addr2 = `${u.city ?? ""}`.trim();
            const phone = u.phone || u.phone1 || u.phone2 || "";

            children.push(
                new Paragraph({
                    children: [new TextRun({ text: `${i + 1}. ${name}`, bold: true })],
                })
            );
            if (addr1) children.push(new Paragraph(addr1));
            if (addr2) children.push(new Paragraph(addr2));
            if (phone) children.push(new Paragraph(phone));
            children.push(new Paragraph({ text: "", spacing: { after: 160 } })); // small gap between stops
        });

        // Totals again at bottom of driver page
        children.push(
            new Paragraph({
                children: [
                    new TextRun({ text: "Total: ", bold: true }),
                    new TextRun(
                        ` ${miles.toFixed(1)} mi  |  Stops: ${stopsCount}  |  Est Time: ${hmm(estMin)}`
                    ),
                ],
                spacing: { before: 200 },
            })
        );
    }

    // One section == one page; two columns configured in section properties
    return {
        properties: {
            page: {
                size: { orientation: PageOrientation.PORTRAIT },
                margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
            },
            column: {
                count: COL_COUNT,
                space: COL_GAP,
                equalWidth: true,
            },
        },
        children,
    };
}

// Build the Unlocated section
function buildUnlocatedSection(unrouted) {
    const children = [];
    children.push(
        new Paragraph({
            text: "Unlocated Addresses (no geocoding)",
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 200 },
        })
    );

    unrouted.forEach((u, i) => {
        const name = `${u.first ?? ""} ${u.last ?? ""}`.trim() || "Customer";
        const addr1 = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
        const addr2 = `${u.city ?? ""}`.trim();
        const phone = u.phone || u.phone1 || u.phone2 || "";
        children.push(new Paragraph({ text: `${i + 1}. ${name}` }));
        if (addr1) children.push(new Paragraph(addr1));
        if (addr2) children.push(new Paragraph(addr2));
        if (phone) children.push(new Paragraph(phone));
        children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
    });

    return {
        properties: {
            page: {
                size: { orientation: PageOrientation.PORTRAIT },
                margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
            },
            column: {
                count: COL_COUNT,
                space: COL_GAP,
                equalWidth: true,
            },
        },
        children,
    };
}

// PUBLIC: compute routes internally and export .docx
export async function exportDriversWord(users, selectedDay, driverCount) {
    const k = Math.max(1, Number(driverCount || 0));
    const dayKey = normalizeDay(selectedDay);
    const list = Array.isArray(users) ? users : [];

    // Active for the selected day
    const active = list.filter(
        (u) => !u?.paused && (dayKey ? Boolean(u?.schedule?.[dayKey]) : true)
    );

    // Geocoded vs missing
    const geocoded = active
        .filter(
            (u) =>
                (u?.lat ?? u?.latitude) != null &&
                (u?.lng ?? u?.longitude) != null
        )
        .map((u) => ({
            ...u,
            lat: u.lat ?? u.latitude,
            lng: u.lng ?? u.longitude,
        }));
    const unrouted = active.filter(
        (u) =>
            (u?.lat ?? u?.latitude) == null ||
            (u?.lng ?? u?.longitude) == null
    );

    // Plan routes (array-of-arrays) via your single source of truth
    const routes = planRoutesBalancedByMilesArrays(geocoded, k);

    const dayTitle = dayKey ? selectedDay : "All Days";

    // Build sections: one section per driver to force page breaks, two columns each
    const sections = routes.map((stops, i) => buildDriverSection(stops, i, dayTitle));

    if (unrouted.length) {
        sections.push(buildUnlocatedSection(unrouted));
    }

    const doc = new Document({
        creator: "Diet Fantasy",
        description: "Driver routes",
        title: `Drivers — ${dayTitle} — ${tsString()}`,
        sections,
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `drivers ${tsString()}.docx`);
}

export default exportDriversWord;