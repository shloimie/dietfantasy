// app/api/ext/attestation/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const prisma = new PrismaClient();

// --- CORS helpers (so a Chrome extension can call this directly) ---
const ALLOW_ORIGIN = process.env.EXT_ORIGIN || "*";
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// --- Types mirrored from your client page ---
type Pt = { x: number; y: number; t: number };
type Stroke = Pt[];
type Signature = Stroke[]; // full signature = array of strokes

type Body = {
    name?: string;    // "Jane Doe" or "Jane"
    phone?: string;   // digits, any formatting accepted
    address?: string; // any substring: street/city/zip
    date?: string;    // MM/DD/YYYY preferred (falls back to today)
};

// --- Utilities copied/adapted from your viewer page ---
function todayString() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}

function cleanDigits(s?: string | null) {
    return String(s ?? "").replace(/\D+/g, "");
}

function normalize(s?: string | null) {
    return String(s ?? "").trim();
}

// Draw "Label: <bold value>"
function drawLabelValueBold(opts: {
    page: any; font: any; bold: any; x: number; y: number; size: number;
    label: string; value: string;
}) {
    const { page, font, bold, x, y, size, label, value } = opts;
    page.drawText(`${label}: `, { x, y, size, font });
    const labelW = font.widthOfTextAtSize(`${label}: `, size);
    page.drawText(value || "—", { x: x + labelW, y, size, font: bold });
}

// Cap-height aligned checkbox + text (same look as your viewer)
function drawCheckedBox(page: any, x: number, yBaseline: number, size: number) {
    const cap = size * 0.70;
    const box = Math.max(10, Math.round(size * 0.90));
    const yBox = yBaseline + (cap / 2) - (box / 2);
    page.drawRectangle({ x, y: yBox, width: box, height: box, borderColor: rgb(0,0,0), borderWidth: 1 });
    const sX = x + box * 0.22, sY = yBox + box * 0.48;
    const mX = x + box * 0.45, mY = yBox + box * 0.22;
    const eX = x + box * 0.82, eY = yBox + box * 0.80;
    page.drawLine({ start: { x: sX, y: sY }, end: { x: mX, y: mY }, thickness: 1 });
    page.drawLine({ start: { x: mX, y: mY }, end: { x: eX, y: eY }, thickness: 1 });
}
function drawCheckboxLine(opts: { page: any; font: any; x: number; y: number; size: number; text: string }) {
    const { page, font, x, y, size, text } = opts;
    drawCheckedBox(page, x, y, size);
    const gap = 8;
    const box = Math.max(10, Math.round(size * 0.90));
    page.drawText(text, { x: x + box + gap, y, size, font });
}

function wrapText(text: string, width: number, fnt: any, size: number): string[] {
    const words = String(text ?? "").split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        const tw = fnt.widthOfTextAtSize(test, size);
        if (tw > width && line) { lines.push(line); line = w; }
        else line = test;
    }
    if (line) lines.push(line);
    return lines;
}

// Embed local logo from /public/df-logo.png if present
async function readLocalLogoBytes(): Promise<Uint8Array | null> {
    try {
        const p = path.join(process.cwd(), "public", "df-logo.png");
        const buf = await fs.readFile(p);
        return new Uint8Array(buf);
    } catch {
        return null;
    }
}

// Render signature strokes directly into the PDF (vector lines)
// Assumes original stroke coords were ~600x160 (your canvas). Scales to a target box.
// Render signature strokes directly into the PDF (vector lines)
// Flips Y because HTML canvas Y grows down, PDF Y grows up.
function drawSignatureStrokes(
    page: any,
    strokes: Signature,
    opts: { x: number; y: number; w: number; h: number }
) {
    const { x, y, w, h } = opts;

    // Original capture canvas size
    const CANVAS_W = 600;
    const CANVAS_H = 160;

    const sx = w / CANVAS_W;
    const sy = h / CANVAS_H;

    for (const s of strokes || []) {
        if (!s || s.length < 2) continue;
        for (let i = 1; i < s.length; i++) {
            const p0 = s[i - 1];
            const p1 = s[i];

            // X maps directly; Y is flipped within the box: bottom = y; top = y + h
            const x0 = x + p0.x * sx;
            const y0 = y + (h - p0.y * sy);
            const x1 = x + p1.x * sx;
            const y1 = y + (h - p1.y * sy);

            page.drawLine({
                start: { x: x0, y: y0 },
                end:   { x: x1, y: y1 },
                thickness: 1.5,
                color: rgb(0, 0, 0),
            });
        }
    }
}
// --- Progressive narrowing search ---
// Strategy:
// 1) If name provided: try by name. If exactly one -> winner.
//    If multiple and phone present, narrow by phone. If still multiple and address present, narrow by address.
//    If still multiple -> 409 with choices.
// 2) Else if phone provided: find by phone, then narrow by address.
// 3) Else if address only: find by address (if >1 -> 409).
async function findUserProgressive({ name, phone, address }: { name?: string; phone?: string; address?: string }) {
    const nameQ = normalize(name);
    const phoneQ = cleanDigits(phone);
    const addrQ = normalize(address);

    const select = {
        id: true, first: true, last: true,
        address: true, apt: true, city: true, state: true, zip: true,
        phone: true,
    } as const;

    // helpers
    const byName = async () => {
        if (!nameQ) return [];
        const parts = nameQ.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            const [a, b] = parts;
            return prisma.user.findMany({
                where: {
                    AND: [
                        { first: { contains: a, mode: "insensitive" } },
                        { last:  { contains: b, mode: "insensitive" } },
                    ],
                },
                select,
                take: 50,
            });
        } else {
            return prisma.user.findMany({
                where: {
                    OR: [
                        { first: { contains: nameQ, mode: "insensitive" } },
                        { last:  { contains: nameQ, mode: "insensitive" } },
                    ],
                },
                select,
                take: 50,
            });
        }
    };

    const byPhone = async () => {
        if (!phoneQ) return [];
        // Compare digits-only version
        const all = await prisma.user.findMany({ where: { phone: { not: null } }, select, take: 500 });
        return all.filter(u => cleanDigits(u.phone) === phoneQ);
    };

    const byAddress = async () => {
        if (!addrQ) return [];
        return prisma.user.findMany({
            where: {
                OR: [
                    { address: { contains: addrQ, mode: "insensitive" } },
                    { city:    { contains: addrQ, mode: "insensitive" } },
                    { zip:     { contains: addrQ, mode: "insensitive" } },
                    { apt:     { contains: addrQ, mode: "insensitive" } },
                ],
            },
            select,
            take: 50,
        });
    };

    // 1) start with name if provided
    if (nameQ) {
        let cands = await byName();
        if (cands.length === 1) return cands[0];
        if (cands.length > 1 && phoneQ) {
            const p = await byPhone();
            if (p.length === 1) return p[0];
            if (p.length > 1) {
                // intersect by phone
                const set = new Set(p.map(u => u.id));
                cands = cands.filter(u => set.has(u.id));
                if (cands.length === 1) return cands[0];
            }
        }
        if (cands.length > 1 && addrQ) {
            const a = await byAddress();
            if (a.length === 1) return a[0];
            if (a.length > 1) {
                const set = new Set(a.map(u => u.id));
                cands = cands.filter(u => set.has(u.id));
                if (cands.length === 1) return cands[0];
            }
        }
        if (cands.length === 1) return cands[0];
        if (cands.length > 1) {
            return { ambiguous: cands.slice(0, 10) } as any;
        }
    }

    // 2) phone first
    if (phoneQ) {
        let cands = await byPhone();
        if (cands.length === 1) return cands[0];
        if (cands.length > 1 && addrQ) {
            const a = await byAddress();
            if (a.length === 1) return a[0];
            if (a.length > 1) {
                const set = new Set(a.map(u => u.id));
                cands = cands.filter(u => set.has(u.id));
                if (cands.length === 1) return cands[0];
            }
        }
        if (cands.length === 1) return cands[0];
        if (cands.length > 1) {
            return { ambiguous: cands.slice(0, 10) } as any;
        }
    }

    // 3) address only
    if (addrQ) {
        const cands = await byAddress();
        if (cands.length === 1) return cands[0];
        if (cands.length > 1) return { ambiguous: cands.slice(0, 10) } as any;
    }

    return null;
}

// --- Main POST ---
export async function POST(req: Request) {
    try {
        const { name, phone, address, date }: Body = await req.json();

        if (!name && !phone && !address) {
            return new NextResponse(
                JSON.stringify({ error: "Provide at least one of: name, phone, address." }),
                { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            );
        }

        const found = await findUserProgressive({ name, phone, address });

        if (!found) {
            return new NextResponse(
                JSON.stringify({ error: "No matching user." }),
                { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            );
        }
        if ((found as any)?.ambiguous) {
            // Tell the client which options to pick from
            return new NextResponse(
                JSON.stringify({ error: "Ambiguous", candidates: (found as any).ambiguous }),
                { status: 409, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            );
        }

        const user = found as {
            id: number; first: string | null; last: string | null;
            address?: string | null; apt?: string | null; city?: string | null; state?: string | null; zip?: string | null;
        };

        // Grab signatures; pick a random one (like your viewer’s “Random” export path)
        const sigs = await prisma.signature.findMany({
            where: { userId: user.id },
            orderBy: [{ slot: "asc" }, { signedAt: "asc" }],
            select: { slot: true, strokes: true },
        });

        if (!sigs.length) {
            return new NextResponse(
                JSON.stringify({ error: "User has no signatures to export." }),
                { status: 422, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
            );
        }

        const chosen = sigs[Math.floor(Math.random() * sigs.length)];
        const strokes = (chosen?.strokes ?? []) as Signature; // array of strokes

        // Build the PDF (structure aligns with your /sign/[token]/view/page.tsx)
        const pdf = await PDFDocument.create();
        const page = pdf.addPage([612, 792]); // US Letter
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

        const margin = 72;
        const lineGap = 18;
        let y = 760;
        const usableWidth = page.getWidth() - margin * 2.5;

        // Header logo (from /public/df-logo.png if present)
        const logoBytes = await readLocalLogoBytes();
        if (logoBytes) {
            try {
                // try PNG first, fallback to JPG
                let logoImg: any;
                try { logoImg = await pdf.embedPng(logoBytes); }
                catch { logoImg = await pdf.embedJpg(logoBytes); }
                const maxW = 240, maxH = 70;
                const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
                const drawW = logoImg.width * scale;
                const drawH = logoImg.height * scale;
                const xLogo = (page.getWidth() - drawW) / 2;
                const yLogo = y - drawH;
                page.drawImage(logoImg, { x: xLogo, y: yLogo, width: drawW, height: drawH });
                y = yLogo - 18;
            } catch { /* ignore embed failures */ }
        }

        // Title
        page.drawText("Member Attestation of Medically Tailored Meal Delivery", { x: margin, y, size: 16, font: bold });
        y -= 28;
        page.drawLine({
            start: { x: margin, y }, end: { x: page.getWidth() - margin, y },
            thickness: 1, color: rgb(0.8, 0.8, 0.8),
        });
        y -= 28;

        // Member info (real address)
        const fullName = `${user.first ?? ""} ${user.last ?? ""}`.trim();
        const addressLine = [
            user.address ?? "", user.apt ?? "",
            [user.city, user.state, user.zip].filter(Boolean).join(" "),
        ].filter(Boolean).join(" ");

        drawLabelValueBold({ page, font, bold, x: margin, y, size: 12, label: "Member Name", value: fullName || "—" });
        y -= lineGap;

        page.drawText(`Address: ${addressLine || "—"}`, { x: margin, y, size: 12, font });
        y -= 30;

        // Meal Delivery Information
        page.drawText("Meal Delivery Information", { x: margin, y, size: 14, font: bold });
        y -= lineGap;

        const dateString = normalize(date) || todayString();
        page.drawText(`Date of Delivery: ${dateString}`, { x: margin + 12, y, size: 12, font });
        y -= lineGap;

        page.drawText("Type of Meals (if applicable):", { x: margin + 12, y, size: 12, font });
        y -= lineGap;
        drawCheckboxLine({ page, font, x: margin + 28, y, size: 12, text: "Breakfast" }); y -= lineGap;
        drawCheckboxLine({ page, font, x: margin + 28, y, size: 12, text: "Lunch" });     y -= lineGap;
        drawCheckboxLine({ page, font, x: margin + 28, y, size: 12, text: "Dinner" });    y -= lineGap;
        drawCheckboxLine({ page, font, x: margin + 28, y, size: 12, text: "Snacks" });

        // Divider
        y -= 30;
        page.drawLine({
            start: { x: margin, y }, end: { x: page.getWidth() - margin, y },
            thickness: 1, color: rgb(0.8, 0.8, 0.8),
        });

        // Attestation
        y -= 30;
        page.drawText("Member Delivery Attestation", { x: margin, y, size: 14, font: bold });
        y -= lineGap * 1.5;

        const firstLineStart = `${fullName || "Member"}`;
        page.drawText(firstLineStart, { x: margin, y, size: 12, font: bold });
        const startWidth = bold.widthOfTextAtSize(firstLineStart, 12);
        const afterName = `  confirms that they personally received their medically tailored meals on ${dateString}.`;
        const remainingWidth = Math.max(0, usableWidth - startWidth);

        if (remainingWidth > 40) {
            const lines = wrapText(afterName, remainingWidth, font, 12);
            if (lines.length) page.drawText(lines[0], { x: margin + startWidth, y, size: 12, font });
            for (let i = 1; i < lines.length; i++) { y -= 16; page.drawText(lines[i], { x: margin, y, size: 12, font }); }
            y -= 16;
        } else {
            y -= 16;
            for (const ln of wrapText(afterName, usableWidth, font, 12)) {
                page.drawText(ln, { x: margin, y, size: 12, font });
                y -= 16;
            }
        }

        const para =
            "This attestation documents that delivery occurred as stated. The information and electronic signature on this form may be used by the Social Care Network and its providers to verify service delivery for compliance and reimbursement purposes. The electronic signature is captured and retained with this record.";
        for (const ln of wrapText(para, usableWidth, font, 12)) {
            page.drawText(ln, { x: margin, y, size: 12, font }); y -= 16;
        }

        // Signature section
        y -= 26;
        page.drawText("Signature", { x: margin, y, size: 14, font: bold });
        y -= 10;

        // Draw strokes into a 300x100 box
        const drawW = 300, drawH = 100;
        const xImg = margin;
        const yImg = y - drawH - 8;
        drawSignatureStrokes(page, strokes, { x: xImg, y: yImg, w: drawW, h: drawH });

        // Date (same as above)
        page.drawText(`Date: ${dateString}`, { x: margin + drawW + 60, y: yImg + drawH / 2, size: 12, font });

        // Footer


        // Return PDF

// Return PDF
        const bytes = await pdf.save(); // Uint8Array

// Get a true ArrayBuffer (typed as ArrayBuffer, not ArrayBufferLike)
        const ab: ArrayBuffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;

        return new NextResponse(ab, {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${(fullName || "member")
                    .replace(/\s+/g, "_")}_attestation.pdf"`,
                ...CORS_HEADERS,
            },
        });


    } catch (err: any) {
        console.error("[ext/attestation] error:", err);
        return new NextResponse(
            JSON.stringify({ error: "Internal error", detail: err?.message }),
            { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
    }
}