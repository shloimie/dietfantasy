// utils/driversPdf.js
// Generates a Word .docx, but exposes a jsPDF-style API:
//   const doc = buildDriversPDF(...); doc.save("drivers.pdf");
// Also provides exportDriversPDF(users, selectedDay, driverCount) for one-shot export.

import {
    Document, Packer, Paragraph, TextRun, HeadingLevel, PageOrientation,
} from "docx";
import { MIN_PER_MILE, MIN_PER_STOP, planRoutesBalancedByMilesArrays } from "./routing";

/* ---------- timestamp ---------- */
export function tsString() {
    const d = new Date();
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return `${mm}-${dd} ${h}:${String(m).padStart(2, "0")}${ampm}`;
}

/* ---------- distance (miles) ---------- */
function toRad(v){ return (v*Math.PI)/180; }
function haversineMi(a,b){
    const R = 3958.7613;
    const dLat = toRad((b.lat ?? b.latitude) - (a.lat ?? a.latitude));
    const dLng = toRad((b.lng ?? b.longitude) - (a.lng ?? a.longitude));
    const lat1 = toRad(a.lat ?? a.latitude);
    const lat2 = toRad(b.lat ?? b.latitude);
    const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(x));
}

/* ---------- helpers ---------- */
function hmm(mins){
    const h = Math.floor(mins/60);
    const m = mins % 60;
    return `${h}:${String(m).padStart(2,"0")}`;
}
function normalizeDay(selectedDay){
    const raw = String(selectedDay || "all").toLowerCase().trim();
    if (raw === "all" || raw === "all days" || raw === "alldays") return null;
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    return days.includes(raw) ? raw : null;
}

/* ---------- core: build a DOCX Document ---------- */
async function buildDocx({ routes, unrouted = [], selectedDay = "all" }) {
    const dayTitle = normalizeDay(selectedDay) ? selectedDay : "All Days";
    const sections = [];

    routes.forEach((stops, i) => {
        const nextMiles = stops.map((s, idx) => (idx < stops.length - 1 ? haversineMi(stops[idx], stops[idx+1]) : null));
        const totalMiles = nextMiles.reduce((a,v)=>a+(v||0),0);
        const stopsCount = stops.length;
        const estMin = Math.round(totalMiles * MIN_PER_MILE + stopsCount * MIN_PER_STOP);

        const children = [];

        children.push(new Paragraph({ text: `Driver ${i+1} — ${dayTitle}`, heading: HeadingLevel.HEADING_1 }));
        children.push(new Paragraph({
            children: [
                new TextRun(`Stops: ${stopsCount}  |  Miles: ${totalMiles.toFixed(1)}  |  Est Time: ${hmm(estMin)}  `),
                new TextRun({ text: `( ${MIN_PER_MILE} min/mi, ${MIN_PER_STOP} min/stop )`, italics: true }),
            ],
            spacing: { after: 200 },
        }));

        if (!stopsCount) {
            children.push(new Paragraph("(No assigned stops)"));
        } else {
            stops.forEach((s, idx) => {
                const name  = `${s.first ?? ""} ${s.last ?? ""}`.trim() || "Customer";
                const addr1 = `${s.address ?? ""}${s.apt ? " " + s.apt : ""}`.trim();
                const addr2 = `${s.city ?? ""}`.trim();
                const phone = s.phone || s.phone1 || s.phone2 || "";

                children.push(new Paragraph({ text: `${idx+1}. ${name}` }));
                if (addr1) children.push(new Paragraph({ text: addr1 }));
                if (addr2) children.push(new Paragraph({ text: addr2 }));
                if (phone) children.push(new Paragraph({ text: phone }));
                if (nextMiles[idx] != null) {
                    children.push(new Paragraph({ text: `${nextMiles[idx].toFixed(1)} mi to next stop`, spacing: { after: 200 } }));
                } else {
                    children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
                }
            });

            children.push(new Paragraph({
                children: [
                    new TextRun({ text: "Total: ", bold: true }),
                    new TextRun(`${totalMiles.toFixed(1)} mi  |  Stops: ${stopsCount}  |  Est Time: ${hmm(estMin)}`),
                ],
                spacing: { before: 240 },
            }));
        }

        sections.push({
            properties: {
                page: { size: { orientation: PageOrientation.PORTRAIT } },
                margins: { top: 720, bottom: 720, left: 720, right: 720 }, // ~0.5"
            },
            children,
        });
    });

    if (unrouted.length) {
        const kids = [];
        kids.push(new Paragraph({ text: "Unlocated Addresses (no geocoding)", heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }));
        unrouted.forEach((u, idx) => {
            const name  = `${u.first ?? ""} ${u.last ?? ""}`.trim() || "Customer";
            const addr1 = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
            const addr2 = `${u.city ?? ""}`.trim();
            const phone = u.phone || u.phone1 || u.phone2 || "";
            kids.push(new Paragraph({ text: `${idx+1}. ${name}` }));
            if (addr1) kids.push(new Paragraph({ text: addr1 }));
            if (addr2) kids.push(new Paragraph({ text: addr2 }));
            if (phone) kids.push(new Paragraph({ text: phone }));
            kids.push(new Paragraph({ text: "", spacing: { after: 160 } }));
        });
        sections.push({ children: kids });
    }

    return new Document({
        creator: "Diet Fantasy",
        description: "Driver routes",
        title: `Drivers — ${dayTitle} — ${tsString()}`,
        sections,
    });
}

/* ---------- PUBLIC: buildDriversPDF (jsPDF-style result) ---------- */
export async function buildDriversPDF({ routes, unrouted = [], selectedDay = "all" }) {
    const doc = await buildDocx({ routes, unrouted, selectedDay });
    const blob = await Packer.toBlob(doc);

    // Provide a jsPDF-like object with .save(filename)
    return {
        /**
         * jsPDF-compatible: doc.save("drivers ... .pdf")
         * We rewrite extension to .docx and trigger a browser download.
         */
        save(fileName) {
            const safe = String(fileName || `drivers ${tsString()}.docx`)
                .replace(/\.pdf$/i, ".docx");
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = safe;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        },
        // Expose the underlying blob too (in case you need it)
        _blob: blob,
    };
}

/* ---------- PUBLIC: one-shot export ---------- */
export async function exportDriversPDF(users, selectedDay, driverCount) {
    // Build routes using the routing barrel (legacy arrays for compatibility)
    const routes = planRoutesBalancedByMilesArrays(
        (Array.isArray(users) ? users : []).map(u => ({
            ...u,
            lat: u.lat ?? u.latitude,
            lng: u.lng ?? u.longitude,
        })),
        Number(driverCount || 0)
    );

    const unrouted = (Array.isArray(users) ? users : []).filter(u =>
        (u?.lat ?? u?.latitude) == null || (u?.lng ?? u?.longitude) == null
    );

    const docLike = await buildDriversPDF({ routes, unrouted, selectedDay });
    // Keep old behavior: export function does the download immediately
    docLike.save(`drivers ${tsString()}.docx`);
}

export default buildDriversPDF;