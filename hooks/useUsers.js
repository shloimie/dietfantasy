"use client";
import React from "react";

export function useUsers() {
    const [users, setUsers] = React.useState([]);

    const fetchUsers = React.useCallback(async () => {
        try {
            const res = await fetch("/api/users", { cache: "no-store" });
            if (!res.ok) throw new Error(`GET /api/users ${res.status}`);
            const data = await res.json();
            setUsers(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("fetchUsers error:", err);
            alert("Failed to load users. Check server/API logs.");
        }
    }, []);

    const addUser = async (payload) => {
        const res = await fetch(`/api/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
    };

    const updateUser = async (id, payload) => {
        const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
    };

    const deleteUser = async (id) => {
        const res = await fetch(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await res.text());
    };

    return { users, fetchUsers, addUser, updateUser, deleteUser };
}