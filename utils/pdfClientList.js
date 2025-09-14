import jsPDF from "jspdf";

export function exportClientListPDF(ordered, tsString) {
    const doc = new jsPDF({ unit: "in", format: "letter" });
    const pageW = 8.5;
    const pageH = 11;
    const margin = 0.5;
    const columnGap = 0.5;
    const contentW = pageW - margin * 2;
    const colW = (contentW - columnGap) / 2;

    const lineH = 0.38;
    const box = 0.22;
    const boxTextGap = 0.14;

    let x = margin;
    let y = margin;
    let col = 0;

    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text("Client List", margin, y);
    y += 0.45;
    doc.setFontSize(13);

    const drawRow = (name) => {
        if (y + lineH > pageH - margin) {
            if (col === 0) {
                col = 1;
                x = margin + colW + columnGap;
                y = margin;
                doc.setFontSize(16);
                doc.text("Client List", x, y);
                y += 0.45;
                doc.setFontSize(13);
            } else {
                doc.addPage();
                col = 0;
                x = margin;
                y = margin;
                doc.setFontSize(16);
                doc.text("Client List", x, y);
                y += 0.45;
                doc.setFontSize(13);
            }
        }
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.02);
        const topY = y - (box - 0.04);
        doc.line(x, topY, x + box, topY);
        doc.line(x, topY, x, topY + box);
        doc.line(x + box, topY, x + box, topY + box);
        doc.line(x, topY + box, x + box, topY + box);
        doc.text(name, x + box + boxTextGap, y + 0.02);
        y += lineH;
    };

    ordered.forEach((u) => {
        const name = `${u.first ?? ""} ${u.last ?? ""}`.trim() || "(Unnamed)";
        drawRow(name);
    });

    doc.save(`client list ${tsString()}.pdf`);
}