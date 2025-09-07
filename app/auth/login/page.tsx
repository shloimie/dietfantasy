"use client";

import { useState } from "react";

export default function LoginPage() {
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setErr(null);
        try {
            const params = new URLSearchParams(window.location.search);
            const next = params.get("next") || "/";
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (!res.ok) {
                const t = await res.text();
                throw new Error(t || "Invalid password");
            }
            window.location.href = next;
        } catch (e: any) {
            setErr(e?.message ?? "Login failed");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", fontFamily: "Arial, sans-serif" }}>
            <form onSubmit={handleSubmit} style={{ width: 320, padding: 24, border: "1px solid #ddd", borderRadius: 8 }}>
                <h2 style={{ marginTop: 0, marginBottom: 16 }}>Enter Password</h2>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    style={{ width: "100%", padding: 10, fontSize: 16, marginBottom: 12 }}
                />
                {err && <div style={{ color: "crimson", marginBottom: 8 }}>{err}</div>}
                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        width: "100%",
                        padding: 10,
                        fontSize: 16,
                        background: "#1976d2",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                    }}
                >
                    {loading ? "Checking…" : "Continue"}
                </button>
            </form>
        </div>
    );
}