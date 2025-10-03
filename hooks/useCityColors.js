// hooks/useCityColors.js
"use client";

import * as React from "react";

// match API normalization
const norm = (s) => String(s || "").trim().toLowerCase();

/**
 * useCityColors(initialMap?)
 * Pure client hook for city→hex colors.
 * - Does NOT auto-create anything from users.
 * - All keys stored normalized (lowercase).
 */
export default function useCityColors(initial = {}) {
    const [cityColors, setCityColors] = React.useState(() => {
        const out = {};
        if (initial && typeof initial === "object") {
            for (const [k, v] of Object.entries(initial)) {
                const hex = String(v || "").trim();
                out[norm(k)] = hex.startsWith("#") ? hex : `#${hex}`;
            }
        }
        return out;
    });

    const getCityColor = React.useCallback(
        (city) => (city ? cityColors[norm(city)] : undefined),
        [cityColors]
    );

    const setCityColor = React.useCallback((city, hex) => {
        if (!city) return;
        const clean = String(hex || "").trim();
        const val = clean.startsWith("#") ? clean : `#${clean}`;
        setCityColors((prev) => ({ ...prev, [norm(city)]: val }));
    }, []);

    const removeCity = React.useCallback((city) => {
        if (!city) return;
        const key = norm(city);
        setCityColors((prev) => {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, []);

    const setAll = React.useCallback((map) => {
        if (!map || typeof map !== "object") {
            setCityColors({});
            return;
        }
        const next = {};
        for (const [k, v] of Object.entries(map)) {
            const clean = String(v || "").trim();
            next[norm(k)] = clean.startsWith("#") ? clean : `#${clean}`;
        }
        setCityColors(next);
    }, []);

    return {
        cityColors,
        getCityColor,
        setCityColor,
        removeCity,
        setAll,
    };
}