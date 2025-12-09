// app/sign/[token]/view/page.tsx
"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

type Pt = { x: number; y: number; t: number };
type Stroke = Pt[];

type Loaded = {
    user: {
        id: number;
        first: string;
        last: string;
        // These should be returned by /api/signatures/admin/[token]
        address?: string | null;
        apt?: string | null;
        city?: string | null;
        state?: string | null;
        zip?: string | null;
    };
    collected: number;
    slots: number[];
    signatures?: {
        slot: number;
        strokes: Stroke[];
        signedAt?: string;
        ip?: string | null;
        userAgent?: string | null;
    }[];
};

function drawStrokes(canvas: HTMLCanvasElement, strokes: Stroke[], width = 600, height = 160) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const s of strokes) {
        ctx.beginPath();
        s.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
    }
}
// helper: return today's date as MM/DD/YYYY
function todayString() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}
// Same-origin logo fetch (no CORS issues)
async function fetchLogoBytes(): Promise<Uint8Array | null> {
    try {
        const r = await fetch("/df-logo.png", { cache: "reload" });
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        return new Uint8Array(buf);
    } catch {
        return null;
    }
}
export default function SignaturesViewPage() {
    const { token } = useParams<{ token: string }>();

    const [data, setData] = useState<Loaded | null>(null);
    const [busy, setBusy] = useState(false);

    // PDF controls
    const [pdfBusy, setPdfBusy] = useState(false);
    const [exportSlot, setExportSlot] = useState<"random" | number>("random");
    const [deliveryDate, setDeliveryDate] = useState<string>(todayString());


    const padRefs = useMemo(() => [
        React.createRef<HTMLCanvasElement>(),
        React.createRef<HTMLCanvasElement>(),
        React.createRef<HTMLCanvasElement>(),
        React.createRef<HTMLCanvasElement>(),
        React.createRef<HTMLCanvasElement>(),
    ], []);

    const load = useCallback(async () => {
        const res = await fetch(`/api/signatures/admin/${token}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const j: Loaded = await res.json();
        setData(j);
    }, [token]);

    useEffect(() => {
        load().catch((e) => alert(e.message || "Failed to load signatures"));
    }, [load]);

    useEffect(() => {
        // draw any provided strokes; if none, canvases remain blank
        if (!data?.signatures) {
            for (const ref of padRefs) {
                const c = ref.current;
                if (c) drawStrokes(c, []);
            }
            return;
        }
        for (const sig of data.signatures) {
            const idx = sig.slot - 1;
            const c = padRefs[idx]?.current;
            if (c) drawStrokes(c, sig.strokes);
        }
        // clear any non-signed slots
        const signedSet = new Set(data.signatures.map((s) => s.slot));
        [1, 2, 3, 4, 5].forEach((slot) => {
            if (!signedSet.has(slot)) {
                const c = padRefs[slot - 1]?.current;
                if (c) drawStrokes(c, []);
            }
        });
    }, [data, padRefs]);

    const handleDeleteAll = async () => {
        if (!confirm("Delete ALL signatures for this user? This cannot be undone.")) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/signatures/admin/${token}`, { method: "DELETE" });
            if (!res.ok) throw new Error(await res.text());
            // Reset local UI
            setData((prev) =>
                prev
                    ? { ...prev, collected: 0, slots: [], signatures: [] }
                    : {
                        user: { id: 0, first: "", last: "" },
                        collected: 0,
                        slots: [],
                        signatures: [],
                    }
            );
            // Clear canvases
            for (const ref of padRefs) {
                const c = ref.current;
                if (c) drawStrokes(c, []);
            }
            alert("All signatures deleted.");
        } catch (e: any) {
            alert(e?.message || "Failed to delete signatures");
        } finally {
            setBusy(false);
        }
    };

    const fullName = useMemo(
        () => (data?.user ? `${data.user.first} ${data.user.last}`.trim() : ""),
        [data?.user]
    );

    const addressLine = useMemo(() => {
        if (!data?.user) return "";
        const parts = [
            data.user.address ?? "",
            data.user.apt ?? "",
            [data.user.city, data.user.state, data.user.zip].filter(Boolean).join(" "),
        ]
            .filter(Boolean)
            .join(" ");
        return parts; // real address only; no placeholders
    }, [data?.user]);

    // Merge detailed slots (from signatures) with basic slots[] so the dropdown only shows signed ones
    const getSignedSlots = useCallback((): number[] => {
        const detailed = data?.signatures?.map((s) => s.slot) ?? [];
        const basic = data?.slots ?? [];
        const merged = Array.from(new Set([...(detailed || []), ...(basic || [])])).filter(Boolean) as number[];
        return merged.sort((a, b) => a - b);
    }, [data?.signatures, data?.slots]);
// Fetch remote image bytes (skips gracefully on CORS failure)
    async function fetchImageBytesFromUrl(url: string): Promise<Uint8Array | null> {
        try {
            const resp = await fetch(url, { cache: "no-store", mode: "cors" as RequestMode });
            if (!resp.ok) return null;
            const buf = await resp.arrayBuffer();
            return new Uint8Array(buf);
        } catch {
            return null;
        }
    }

// Draw "Label: <bold value>" on one line
    function drawLabelValueBold(opts: {
        page: any; font: any; bold: any; x: number; y: number; size: number;
        label: string; value: string;
    }) {
        const { page, font, bold, x, y, size, label, value } = opts;
        // label
        page.drawText(`${label}: `, { x, y, size, font });
        const labelWidth = font.widthOfTextAtSize(`${label}: `, size);
        // bold value
        page.drawText(value || "—", { x: x + labelWidth, y, size, font: bold });
    }


// Center the box on the text's cap-height (≈ 0.70 of font size) for clean alignment
    function drawCheckedBox(page: any, x: number, yBaseline: number, size: number) {
        const cap = size * 0.70;              // approximate cap height of Helvetica
        const box = Math.max(10, Math.round(size * 0.90)); // box proportional to text size
        const yBox = yBaseline + (cap / 2) - (box / 2);    // center box to cap-height band

        // square outline
        page.drawRectangle({
            x,
            y: yBox,
            width: box,
            height: box,
            borderColor: rgb(0, 0, 0),
            borderWidth: 1,
        });

        // checkmark (two strokes, inset)
        const sX = x + box * 0.22;
        const sY = yBox + box * 0.48;
        const mX = x + box * 0.45;
        const mY = yBox + box * 0.22;
        const eX = x + box * 0.82;
        const eY = yBox + box * 0.80;

        page.drawLine({ start: { x: sX, y: sY }, end: { x: mX, y: mY }, thickness: 1 });
        page.drawLine({ start: { x: mX, y: mY }, end: { x: eX, y: eY }, thickness: 1 });
    }

// Same signature as before; now uses the cap-height aligned box
    function drawCheckboxLine(opts: { page: any; font: any; x: number; y: number; size: number; text: string }) {
        const { page, font, x, y, size, text } = opts;
        drawCheckedBox(page, x, y, size);
        const gap = 8; // spacing between box and text
        page.drawText(text, { x: x + Math.max(10, Math.round(size * 0.90)) + gap, y, size, font });
    }
    // Create PDF using selected/random signature and user-entered deliveryDate
// Create PDF using selected/random signature and user-entered deliveryDate
    // Create PDF using selected/random signature and user-entered deliveryDate
    async function handleDownloadPdf() {
        if (pdfBusy || !data) return;

        const signedSlots = getSignedSlots();
        if (!signedSlots.length) return;

        const slot = exportSlot === "random"
            ? signedSlots[Math.floor(Math.random() * signedSlots.length)]
            : exportSlot;

        if (exportSlot !== "random" && !signedSlots.includes(exportSlot)) return;

        const canvas = padRefs[slot - 1]?.current;
        if (!canvas) return;

        try {
            setPdfBusy(true);

            // Snapshot signature from canvas
            const dataUrl = canvas.toDataURL("image/png");
            const base64 = dataUrl.split(",")[1] || "";
            const bin = atob(base64);
            const imgBytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) imgBytes[i] = bin.charCodeAt(i);

            // Build PDF
            const pdf = await PDFDocument.create();
            const page = pdf.addPage([612, 792]); // US Letter
            const font = await pdf.embedFont(StandardFonts.Helvetica);
            const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

            const margin = 72;
            const lineGap = 18;
            let y = 760;

            // ONE width used for wrapping everywhere
            const usableWidth = page.getWidth() - margin * 2.5;

            // === Header logo (served from /public) ===
            const logoBytes = await fetchLogoBytes();
            if (logoBytes) {
                try {
                    const logoImg = await pdf.embedPng(logoBytes).catch(async () => await pdf.embedJpg(logoBytes));
                    const maxW = 240, maxH = 70;
                    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
                    const drawW = logoImg.width * scale;
                    const drawH = logoImg.height * scale;
                    const xLogo = (page.getWidth() - drawW) / 2;
                    const yLogo = y - drawH;
                    page.drawImage(logoImg, { x: xLogo, y: yLogo, width: drawW, height: drawH });
                    y = yLogo - 18; // space under logo
                } catch { /* ignore if embed fails */ }
            }

            // Title
            page.drawText("Member Attestation of Medically Tailored Meal Delivery", {
                x: margin, y, size: 16, font: bold,
            });
            y -= 28;
            page.drawLine({
                start: { x: margin, y }, end: { x: page.getWidth() - margin, y },
                thickness: 1, color: rgb(0.8, 0.8, 0.8),
            });
            y -= 28;

            // Member info (real address)
            const fullName = `${data.user.first ?? ""} ${data.user.last ?? ""}`.trim();
            const addressLine = [
                data.user.address ?? "",
                data.user.apt ?? "",
                [data.user.city, data.user.state, data.user.zip].filter(Boolean).join(" "),
            ].filter(Boolean).join(" ");

            drawLabelValueBold({ page, font, bold, x: margin, y, size: 12, label: "Member Name", value: fullName || "—" });
            y -= lineGap;

            page.drawText(`Address: ${addressLine || "—"}`, { x: margin, y, size: 12, font });
            y -= 30;

            // Meal Delivery Information
            page.drawText("Meal Delivery Information", { x: margin, y, size: 14, font: bold });
            y -= lineGap;

            const dateString = deliveryDate.trim();
            page.drawText(`Date of Delivery: ${dateString || "—"}`, { x: margin + 12, y, size: 12, font });
            y -= lineGap;

            // Type of Meals (checked boxes)
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

            // --- Attestation (DELIVERY CONFIRMATION) ---
            y -= 30;
            page.drawText("Member Delivery Attestation", { x: margin, y, size: 14, font: bold });
            y -= lineGap * 1.5;

            // First sentence: bold member name + wrapped continuation
            const firstLineStart = `${fullName || "Member"}`;
            page.drawText(firstLineStart, { x: margin, y, size: 12, font: bold });
            const startWidth = bold.widthOfTextAtSize(firstLineStart, 12);

            const afterName =
                `  confirms that they personally received their medically tailored meals on ${dateString || "the date indicated above"}.`;

            // Remaining width on the current line after the name
            const remainingWidth = Math.max(0, usableWidth - startWidth);

            if (remainingWidth > 40) {
                const lines = wrapText(afterName, remainingWidth, font, 12);
                if (lines.length) {
                    page.drawText(lines[0], { x: margin + startWidth, y, size: 12, font });
                }
                for (let i = 1; i < lines.length; i++) {
                    y -= 16;
                    page.drawText(lines[i], { x: margin, y, size: 12, font });
                }
                y -= 16;
            } else {
                y -= 16;
                for (const ln of wrapText(afterName, usableWidth, font, 12)) {
                    page.drawText(ln, { x: margin, y, size: 12, font });
                    y -= 16;
                }
            }

            // Paragraph (wrapped)
            const para =
                "This attestation documents that delivery occurred as stated. The information and electronic signature on this form may be used by the Social Care Network and its providers to verify service delivery for compliance and reimbursement purposes. The electronic signature is captured and retained with this record.";

            for (const ln of wrapText(para, usableWidth, font, 12)) {
                page.drawText(ln, { x: margin, y, size: 12, font });
                y -= 16;
            }

            // --- Signature section ---
            y -= 26;
            page.drawText("Signature", { x: margin, y, size: 14, font: bold });
            y -= 10;

            // Embed signature image
            let embedded;
            try {
                embedded = await pdf.embedPng(imgBytes);
            } catch {
                embedded = await pdf.embedJpg(imgBytes);
            }
            const maxW = 300, maxH = 100;
            const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
            const drawW = embedded.width * scale;
            const drawH = embedded.height * scale;
            const xImg = margin;
            const yImg = y - drawH - 8;
            page.drawImage(embedded, { x: xImg, y: yImg, width: drawW, height: drawH });

            // Date (same as above)
            page.drawText(`Date: ${dateString || "—"}`, {
                x: margin + drawW + 60,
                y: yImg + drawH / 2,
                size: 12,
                font,
            });

            // Footer
            page.drawText(
                "For internal use only – retain this attestation for program and audit records.",
                { x: margin, y: 72, size: 10, font, color: rgb(0.3, 0.3, 0.3) }
            );

            // Download (TS-safe: ensure ArrayBuffer, not SharedArrayBuffer union)
            const bytes = await pdf.save(); // Uint8Array (ArrayBufferLike)
            const ab = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(ab).set(bytes); // copy -> now backed by a true ArrayBuffer
            const blob = new Blob([ab], { type: "application/pdf" });

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const fname = (fullName || "member").replace(/\s+/g, "_");
            a.href = url;
            a.download = `${fname}_attestation.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } finally {
            setPdfBusy(false);
        }
    }



    // simple wrapper for paragraph text
    function wrapText(text: string, width: number, fnt: any, size: number): string[] {
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let line = "";
        for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            const tw = fnt.widthOfTextAtSize(test, size);
            if (tw > width && line) {
                lines.push(line);
                line = w;
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    if (!data) {
        return <div style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>Loading…</div>;
    }

    return (
        <div style={{ maxWidth: 780, margin: "36px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
            {/* Header with controls */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: 24, marginBottom: 8 }}>
                    {data.user.first} {data.user.last} — Completed Signatures ({data.collected}/5)
                </h1>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {/* Export slot picker */}
                    <label style={{ fontSize: 12, color: "#374151" }}>
                        Export:
                        <select
                            value={exportSlot as any}
                            onChange={(e) => {
                                const v = e.target.value;
                                setExportSlot(v === "random" ? "random" : Number(v));
                            }}
                            style={{
                                marginLeft: 6,
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid #e5e7eb",
                                background: "#fff",
                                cursor: "pointer",
                            }}
                            title="Choose which signature to export"
                        >
                            <option value="random">Random</option>
                            {getSignedSlots().map((slot) => (
                                <option key={`slot-${slot}`} value={slot}>
                                    Signature {slot}
                                </option>
                            ))}
                        </select>
                    </label>

                    {/* Delivery date textbox (used in two places in the PDF) */}
                    <input
                        type="text"
                        inputMode="text"
                        placeholder="Delivery Date (e.g. 10/12/2025)"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        style={{
                            padding: "6px 8px",
                            borderRadius: 8,
                            border: "1px solid #e5e7eb",
                            background: "#fff",
                            minWidth: 200,
                        }}
                        title="Enter the delivery date to include on the PDF"
                    />

                    {/* Download PDF */}
                    <button
                        onClick={handleDownloadPdf}
                        disabled={pdfBusy || getSignedSlots().length === 0}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid #111827",
                            background: "#111827",
                            color: "#fff",
                            fontWeight: 600,
                            cursor: pdfBusy || getSignedSlots().length === 0 ? "not-allowed" : "pointer",
                        }}
                        title="Download the attestation PDF with the selected signature"
                    >
                        {pdfBusy ? "Building…" : "Download PDF"}
                    </button>

                    {/* Delete All */}
                    <button
                        onClick={handleDeleteAll}
                        disabled={busy}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid #c00",
                            background: "#c00",
                            color: "#fff",
                            fontWeight: 600,
                            cursor: busy ? "not-allowed" : "pointer",
                        }}
                        title="Delete all signatures for this user"
                    >
                        {busy ? "Deleting…" : "Delete All"}
                    </button>
                </div>
            </div>

            <p style={{ marginBottom: 16, color: "#666" }}>
                Read-only preview. Timestamp/IP/UA are shown when available.
            </p>

            {[1, 2, 3, 4, 5].map((slot) => {
                const done = data.slots?.includes(slot);
                const meta = data.signatures?.find((s) => s.slot === slot);
                return (
                    <div key={slot} style={{ marginBottom: 18 }}>
                        <div style={{ margin: "6px 0", fontWeight: 600 }}>
                            Slot {slot} {done ? "✓" : "—"}
                        </div>
                        <canvas
                            ref={padRefs[slot - 1]}
                            style={{
                                display: "block",
                                width: 600,
                                height: 160,
                                background: "#f9f9f9",
                                borderRadius: 8,
                                border: "1px solid #e1e1e1",
                            }}
                        />
                        {meta ? (
                            <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                                Signed: {meta.signedAt ? new Date(meta.signedAt).toLocaleString() : "—"}
                                {meta.ip ? ` • IP: ${meta.ip}` : ""} {meta.userAgent ? ` • UA: ${meta.userAgent}` : ""}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}