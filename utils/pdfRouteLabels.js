// utils/pdfRouteLabels.js
// Route-ordered, driver-colored Avery 5163 labels (4" x 2", 2x5 per page).
// Does NOT touch/replace your original labels module.

import jsPDF from "jspdf";

/**
 * Styled word-wrap with optional "(... out of ...)" highlight in pink.
 * If opts.dryRun === true, only measures height (no drawing).
 * Returns new Y after the block.
 */
function drawStyledWrappedLine(doc, line, x, startY, maxWidth, lineH, baseRGB, opts = {}) {
    const { dryRun = false } = opts;
    if (!line) return startY + lineH;

    const re = /\(?\d*\s*[o0]ut\s+of\s+\d*\)?/i;
    const m = re.exec(line);
    const highlightPink = [255, 20, 147];

    const segs = m
        ? [
            { text: line.slice(0, m.index), hi: false },
            { text: m[0], hi: true },
            { text: line.slice(m.index + m[0].length), hi: false },
        ]
        : [{ text: line, hi: false }];

    let y = startY;
    let currentLine = [];
    let width = 0;

    const measure = (t, bold) => {
        doc.setFont(undefined, bold ? "bold" : "normal");
        return doc.getTextWidth(t);
    };

    const flush = () => {
        if (!dryRun) {
            let cx = x;
            for (const part of currentLine) {
                if (part.hi) {
                    doc.setTextColor(...highlightPink);
                    doc.setFont(undefined, "bold");
                } else {
                    doc.setTextColor(...baseRGB);
                    doc.setFont(undefined, "normal");
                }
                doc.text(part.t, cx, y, { baseline: "top" });
                cx += measure(part.t, part.hi);
            }
        }
        currentLine = [];
        width = 0;
        y += lineH;
    };

    const pushToken = (tok, hi) => {
        if (measure(tok, hi) > maxWidth) {
            let buf = "";
            for (const ch of tok) {
                const w = measure(buf + ch, hi);
                if (width + w > maxWidth) {
                    if (buf) {
                        currentLine.push({ t: buf, hi });
                        flush();
                    } else {
                        currentLine.push({ t: ch, hi });
                        flush();
                        continue;
                    }
                    buf = ch;
                } else {
                    buf += ch;
                }
            }
            if (buf) {
                const w2 = measure(buf, hi);
                if (width + w2 > maxWidth) {
                    flush();
                    currentLine.push({ t: buf, hi });
                    width = w2;
                } else {
                    currentLine.push({ t: buf, hi });
                    width += w2;
                }
            }
            return;
        }
        const w = measure(tok, hi);
        if (width + w > maxWidth) flush();
        currentLine.push({ t: tok, hi });
        width += w;
    };

    for (const seg of segs) {
        if (!seg.text) continue;
        const tokens = seg.text.split(/(\s+)/);
        for (const tk of tokens) pushToken(tk, seg.hi);
    }
    if (currentLine.length) flush();
    return y;
}

function measureBlockHeight(doc, lines, fontSize, maxWidth, lineHeight, baseRGB) {
    const prev = doc.getFontSize();
    doc.setFontSize(fontSize);
    let y = 0;
    for (const ln of lines) {
        y = drawStyledWrappedLine(doc, ln, 0, y, maxWidth, lineHeight, baseRGB, { dryRun: true });
    }
    doc.setFontSize(prev);
    return y;
}

function hexToRgbArray(hex) {
    const h = (hex || "#000000").replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return [r, g, b];
}

// Avery 5163 grid
const LABEL_W = 4.0;
const LABEL_H = 2.0;
const MARGIN_L = 0.25;
const MARGIN_T = 0.5;
const PAD_L = 0.20, PAD_R = 0.20, PAD_T = 0.35, PAD_B = 0.20;

// Typography
const MAX_FONT = 11;
const MIN_FONT = 6;
const lineHeightFromFont = (pt) => Math.max(0.18, pt * 0.025);

// default palette if not provided
const DEFAULT_DRIVER_COLORS = [
    "#1677FF", "#52C41A", "#FA8C16", "#EB2F96", "#13C2C2",
    "#F5222D", "#722ED1", "#A0D911", "#2F54EB", "#FAAD14",
    "#73D13D", "#36CFC9",
];

function drawOneLabel(doc, x, y, colorRGB, lines) {
    const maxW = Math.max(0, LABEL_W - PAD_L - PAD_R);
    const maxH = Math.max(0, LABEL_H - PAD_T - PAD_B);

    let font = MAX_FONT;
    let lh = lineHeightFromFont(font);
    let blockH = measureBlockHeight(doc, lines, font, maxW, lh, colorRGB);
    while (blockH > maxH && font > MIN_FONT) {
        font -= 1;
        lh = lineHeightFromFont(font);
        blockH = measureBlockHeight(doc, lines, font, maxW, lh, colorRGB);
    }

    doc.setFontSize(font);
    let yy = y + PAD_T;
    const xx = x + PAD_L;
    for (const ln of lines) {
        yy = drawStyledWrappedLine(doc, ln, xx, yy, maxW, lh, colorRGB);
    }
}

/**
 * NEW public API (route-ordered, driver-colored).
 * routes: Array<Array<UserLike>> (driver i's stops in order)
 * driverColors: optional hex array per driver
 */
export async function exportRouteLabelsPDF(routes, driverColors, tsString) {
    const doc = new jsPDF({ unit: "in", format: "letter" });

    const palette = (driverColors && driverColors.length) ? driverColors : DEFAULT_DRIVER_COLORS;

    let x = MARGIN_L, y = MARGIN_T, col = 0, row = 0;

    routes.forEach((stops, driverIdx) => {
        const colorRGB = hexToRgbArray(palette[driverIdx % palette.length]);

        stops.forEach((u) => {
            const lines = [
                `${u.first ?? ""} ${u.last ?? ""}`.trim(),
                `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                `${u.city ?? ""} ${u.state ?? ""}`.trim(),
                `Phone: ${u.phone ?? ""}`.trim(),
                `Dislikes: ${u.dislikes ?? ""}`.trim(),
            ];
            drawOneLabel(doc, x, y, colorRGB, lines);

            // advance grid
            col++;
            if (col === 2) { col = 0; row++; x = MARGIN_L; y += LABEL_H; }
            else { x += LABEL_W; }

            if (row === 5) { doc.addPage(); x = MARGIN_L; y = MARGIN_T; col = 0; row = 0; }
        });
    });

    doc.save(`labels (route order) ${tsString()}.pdf`);
}