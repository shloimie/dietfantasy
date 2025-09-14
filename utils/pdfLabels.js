// utils/pdfLabels.js
// Avery 5163 (4" x 2") labels, two columns x five rows.
// Auto-shrinks font size if wrapped content won't fit vertically.

import jsPDF from "jspdf";

/**
 * drawStyledWrappedLine
 * - Supports highlight for "(... out of ...)" / "out of" / "0ut of" variants
 * - Word-wraps with width constraint
 * - Optional dryRun to measure height without drawing
 *
 * Returns the new y position after drawing (or measuring).
 */
function drawStyledWrappedLine(doc, line, x, startY, maxWidth, lineH, baseRGB, opts = {}) {
    const { dryRun = false } = opts;

    if (!line) return startY + lineH;

    // allow 0 instead of o, optional digits/parens
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
        // break very long tokens by char
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
        const tokens = seg.text.split(/(\s+)/); // keep spaces
        for (const tk of tokens) pushToken(tk, seg.hi);
    }
    if (currentLine.length) flush();

    return y;
}

/** Measure total block height for given lines/font/lineHeight without drawing. */
function measureBlockHeight(doc, lines, fontSize, maxWidth, lineHeight, baseRGB) {
    const prevSize = doc.getFontSize();
    doc.setFontSize(fontSize);
    let y = 0;
    for (const line of lines) {
        y = drawStyledWrappedLine(doc, line, 0, y, maxWidth, lineHeight, baseRGB, { dryRun: true });
    }
    doc.setFontSize(prevSize);
    return y;
}

export async function exportLabelsPDF(ordered, getCityColor, hexToRgb, tsString) {
    const doc = new jsPDF({ unit: "in", format: "letter" });

    // Avery 5163: 2 cols x 5 rows = 10 labels/page
    const labelWidth = 4.0;
    const labelHeight = 2.0;
    const marginLeft = 0.25;
    const marginTop = 0.5;

    const padLeft = 0.20;
    const padRight = 0.20;
    const padTop = 0.35;
    const bottomPad = 0.20;

    // dynamic typography bounds
    const MAX_FONT = 11;
    const MIN_FONT = 6; // don't go smaller than this
    const lineHeightFromFont = (font) => Math.max(0.18, font * 0.025); // ~0.275 at 11pt

    let x = marginLeft;
    let y = marginTop;
    let col = 0;
    let row = 0;

    ordered.forEach((u) => {
        const lines = [
            `${u.first ?? ""} ${u.last ?? ""}`.trim(),
            `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
            `${u.city ?? ""} ${u.state ?? ""}`.trim(),
            `Phone: ${u.phone ?? ""}`.trim(),
            `Dislikes: ${u.dislikes ?? ""}`.trim(),
        ];

        const hex = getCityColor(u.city);
        const baseRGB = hex ? hexToRgb(hex) : [0, 0, 0];

        const maxTextWidth = Math.max(0, labelWidth - padLeft - padRight);
        const maxTextHeight = Math.max(0, labelHeight - padTop - bottomPad);

        // choose a font size that fits vertically
        let fontSize = MAX_FONT;
        let lineH = lineHeightFromFont(fontSize);
        let blockH = measureBlockHeight(doc, lines, fontSize, maxTextWidth, lineH, baseRGB);

        while (blockH > maxTextHeight && fontSize > MIN_FONT) {
            fontSize -= 1;
            lineH = lineHeightFromFont(fontSize);
            blockH = measureBlockHeight(doc, lines, fontSize, maxTextWidth, lineH, baseRGB);
        }

        // draw with chosen size
        doc.setFontSize(fontSize);
        let lineY = y + padTop;
        const textX = x + padLeft;
        for (const line of lines) {
            lineY = drawStyledWrappedLine(doc, line, textX, lineY, maxTextWidth, lineH, baseRGB);
        }

        // advance grid
        col++;
        if (col === 2) {
            col = 0;
            row++;
            x = marginLeft;
            y += labelHeight;
        } else {
            x += labelWidth;
        }

        // new page after 5 rows
        if (row === 5) {
            doc.addPage();
            x = marginLeft;
            y = marginTop;
            col = 0;
            row = 0;
        }
    });

    doc.save(`labels ${tsString()}.pdf`);
}