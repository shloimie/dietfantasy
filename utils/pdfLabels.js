import jsPDF from "jspdf";

/* ====== Fit helpers ====== */

/** Convert font size in points to a comfortable line height in INCHES */
function lineHeightInches(fontPt) {
    // ~1.8x leading looks close to your original 0.28" at 11pt
    return (fontPt / 72) * 1.8;
}

/** Measure total height (in inches) of all label lines at current font size */
function measureBlockHeight(doc, lines, maxWidth, lineH) {
    let total = 0;
    for (const line of lines) {
        const arr = doc.splitTextToSize(String(line ?? ""), maxWidth);
        total += Math.max(1, arr.length) * lineH;
    }
    return total;
}

/**
 * Find the largest font size (pt) that fits all lines into maxHeight (in).
 * Decreases in 0.5pt steps from startPt down to minPt.
 */
function findFittingFontSize(doc, lines, maxWidth, maxHeight, startPt = 11, minPt = 7) {
    let bestPt = minPt;
    for (let pt = startPt; pt >= minPt; pt -= 0.5) {
        doc.setFontSize(pt);
        const lh = lineHeightInches(pt);
        const h = measureBlockHeight(doc, lines, maxWidth, lh);
        if (h <= maxHeight) {
            bestPt = pt;
            break;
        }
    }
    return { fontPt: bestPt, lineH: lineHeightInches(bestPt) };
}

/* ====== Highlight-aware wrapping/drawing ====== */

// highlight-aware wrapped line with "(... out of ...)" or "0ut" variants
function drawStyledWrappedLine(doc, line, x, startY, maxWidth, lineH, baseRGB) {
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

/* ====== Main export ====== */

export async function exportLabelsPDF(ordered, getCityColor, hexToRgb, tsString) {
    const doc = new jsPDF({ unit: "in", format: "letter" });

    // Avery 5163: 2 cols x 5 rows = 10 labels/page
    const labelWidth = 4.0;
    const labelHeight = 2.0;
    const marginLeft = 0.25;
    const marginTop = 0.5;

    const padLeft = 0.2;
    const padRight = 0.2;
    const padTop = 0.35;      // tuned
    const padBottom = 0.15;   // new: explicit bottom padding

    const LOGO_W = 1.0;
    const LOGO_H = 0.33;
    const LOGO_RIGHT_PADDING = 0.15;

    // optional logo
    let logoDataUrl = null;
    async function ensureLogo() {
        if (logoDataUrl) return logoDataUrl;
        try {
            const res = await fetch("https://thedietfantasy.com/wp-content/uploads/2023/07/logos-03-03.png", { mode: "cors" });
            const blob = await res.blob();
            const reader = new FileReader();
            const p = new Promise((r) => (reader.onloadend = () => r(reader.result)));
            reader.readAsDataURL(blob);
            logoDataUrl = await p;
            return logoDataUrl;
        } catch {
            return null;
        }
    }
    const logo = await ensureLogo();

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

        // reserve right column width if logo present
        const reservedRight = logo ? (LOGO_W + LOGO_RIGHT_PADDING) : 0;
        const maxTextWidth = Math.max(0, labelWidth - padLeft - padRight - reservedRight);
        const availableHeight = Math.max(0, labelHeight - padTop - padBottom);

        // 1) Find the biggest font size that fits
        //    Start at 11pt (your original), shrink to as low as 7pt if needed
        const { fontPt, lineH } = findFittingFontSize(doc, lines, maxTextWidth, availableHeight, 11, 7);
        doc.setFontSize(fontPt);

        // 2) Draw logo (doesn't affect text height since we keep to the left)
        if (logo) {
            try {
                const logoX = x + labelWidth - LOGO_W - LOGO_RIGHT_PADDING;
                const logoY = y + 0.10;
                doc.addImage(logo, "PNG", logoX, logoY, LOGO_W, LOGO_H);
            } catch {}
        }

        // 3) Draw text using the fitted font size and computed line height
        let lineY = y + padTop;
        const textX = x + padLeft;
        for (const line of lines) {
            lineY = drawStyledWrappedLine(doc, line, textX, lineY, maxTextWidth, lineH, baseRGB);
            // If we somehow overflow (extreme content), stop drawing further lines
            if (lineY > y + labelHeight - padBottom) break;
        }

        // 4) Advance label position
        col++;
        if (col === 2) {
            col = 0;
            row++;
            x = marginLeft;
            y += labelHeight;
        } else {
            x += labelWidth;
        }

        if (row === 5) {
            doc.addPage();
            x = marginLeft;
            y = marginTop;
            col = 0;
            row = 0;
        }
    });

    doc.save(`label ${tsString()}.pdf`);
}