"use client";
import React from "react";
import { cityKey, hexToRgb } from "../lib/colors";

export function useCityColors() {
    const [cityColors, setCityColors] = React.useState({});

    const fetchCityColors = React.useCallback(async () => {
        try {
            const res = await fetch("/api/city-colors", { cache: "no-store" });
            if (!res.ok) throw new Error(`GET /api/city-colors ${res.status}`);
            const rows = await res.json();
            const map = {};
            for (const r of rows) map[String(r.city).toLowerCase()] = r.color;
            setCityColors(map);
        } catch (e) {
            console.error("fetchCityColors error:", e);
        }
    }, []);

    const addCityColor = async (cityInput, colorInput) => {
        const key = cityKey(cityInput);
        if (!key) return;
        const res = await fetch("/api/city-colors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ city: key, color: colorInput }),
        });
        if (!res.ok) throw new Error(await res.text());
        await fetchCityColors();
    };

    const removeCityColor = async (key) => {
        const res = await fetch(`/api/city-colors/${encodeURIComponent(key)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await res.text());
        await fetchCityColors();
    };

    const getCityColor = (c) => cityColors[cityKey(c)] || null;

    return { cityColors, fetchCityColors, addCityColor, removeCityColor, getCityColor, hexToRgb };
}