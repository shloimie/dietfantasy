import React from "react";
import { Button } from "@mui/material";

const columns = [
    { key: "first", label: "FIRST" },
    { key: "last", label: "LAST" },
    { key: "address", label: "ADDRESS" },
    { key: "apt", label: "APT" },
    { key: "city", label: "CITY" },
    { key: "dislikes", label: "DISLIKES" },
    { key: "county", label: "COUNTY" },
    { key: "zip", label: "ZIP" },
    { key: "state", label: "STATE" },
    { key: "phone", label: "PHONE" },
    { key: "medicaid", label: "MEDICAID" },
    { key: "paused", label: "paused" },
    { key: "complex", label: "complex" },
    { key: "schedule", label: "SCHEDULE" },
];

export default function UsersTable({
                                       users,
                                       onSort,
                                       sortKey,
                                       sortAsc,
                                       getCityColor,
                                       onEdit,
                                       onDelete,
                                   }) {
    return (
        <table border="1" cellPadding="6" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
            <tr>
                <th style={{ width: 50 }}>#</th>
                {columns.map((c) => (
                    <th
                        key={c.key}
                        onClick={() => onSort(c.key)}
                        style={{ cursor: "pointer" }}
                        title="Click to sort"
                    >
                        {c.label}{sortKey === c.key ? (sortAsc ? " ▲" : " ▼") : ""}
                    </th>
                ))}

            <th>GEO</th>
                <th>ACTIONS</th>
            </tr>
            </thead>
            <tbody>
            {users.map((u, i) => (
                <tr key={u.id}>
                    <td>{i + 1}</td>
                    <td>{u.first}</td>
                    <td>{u.last}</td>
                    <td>{u.address}</td>
                    <td>{u.apt}</td>
                    <td>
              <span
                  style={{
                      color: getCityColor(u.city) || "inherit",
                      fontWeight: 600,
                  }}
              >
                {u.city}
              </span>
                    </td>
                    <td>{u.dislikes}</td>
                    <td>{u.county}</td>
                    <td>{u.zip}</td>
                    <td>{u.state}</td>
                    <td>{u.phone}</td>
                    <td>{u.medicaid ? "Yes" : "No"}</td>
                    <td>{u.paused ? "Yes" : "No"}</td>
                    <td>{u.complex ? "Yes" : "No"}</td>
                    <td>
                        {u.schedule
                            ? ["M", "T", "W", "Th", "F", "Sa", "Su"]
                                .filter((_, idx) => {
                                    const k = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
                                    return u.schedule[k[idx]];
                                })
                                .join(" ")
                            : ""}
                    </td>

                    <td title={u.lat != null && u.lng != null ? "Geocoded" : "Missing"}>
                        {u.lat != null && u.lng != null ? "✓" : "—"}
                    </td>
                    <td>
                        <Button size="small" onClick={() => onEdit(u)}>Edit</Button>
                        <Button
                            size="small"
                            color="error"
                            onClick={() => onDelete(u.id)}
                            style={{ marginLeft: 6 }}
                        >
                            Delete
                        </Button>
                    </td>
                </tr>
            ))}
            </tbody>
        </table>
    );
}