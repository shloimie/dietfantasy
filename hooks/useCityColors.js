// hooks/useCityColors.js
"use client";

import * as React from "react";

// Nice default palette to rotate through when we discover new cities
const PALETTE = [
    "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00",
    "#a65628", "#f781bf", "#999999", "#66c2a5", "#fc8d62",
    "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494",
];

function buildInitialMap(users = []) {
    const map = {};
    let i = 0;
    for (const u of users) {
        const city = (u?.city || "").trim();
        if (!city) continue;
        if (!map[city]) {
            map[city] = PALETTE[i % PALETTE.length];
            i++;
        }
    }
    return map;
}

/**
 * useCityColors(users, initial)
 * - Always returns a non-null object for cityColors
 * - getCityColor(city) is safe to call
 */
export default function useCityColors(users = [], initial = {}) {
    const seeded = React.useMemo(
        () => ({ ...buildInitialMap(users), ...(initial || {}) }),
        [users, initial]
    );

    const [cityColors, setCityColors] = React.useState(seeded);

    // keep derived map in sync if users change (only add missing keys)
    React.useEffect(() => {
        setCityColors((prev) => {
            const next = { ...prev };
            const base = buildInitialMap(users);
            for (const [city, hex] of Object.entries(base)) {
                if (!next[city]) next[city] = hex;
            }
            return next;
        });
    }, [users]);

    const getCityColor = React.useCallback(
        (city) => (city ? cityColors[city] : undefined),
        [cityColors]
    );

    const setCityColor = React.useCallback((city, hex) => {
        if (!city) return;
        setCityColors((prev) => ({ ...prev, [city]: hex }));
    }, []);

    const setAll = React.useCallback((map) => {
        setCityColors(map && typeof map === "object" ? { ...map } : {});
    }, []);

    return { cityColors: cityColors || {}, getCityColor, setCityColor, setAll };
}