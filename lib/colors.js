export const cityKey = (c) => String(c || "").trim().toLowerCase();

export const hexToRgb = (hex) => {
    if (!hex || typeof hex !== "string") return [0, 0, 0];
    const m = hex.replace("#", "");
    const bigint = parseInt(m.length === 3 ? m.split("").map((ch) => ch + ch).join("") : m, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
};

