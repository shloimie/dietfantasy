// components/UsersTable.jsx
"use client";

import React from "react";
import {
    Box,
    Button,
    CircularProgress,
    IconButton,
    Stack,
    Tooltip,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DoneIcon from "@mui/icons-material/Done";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";

export default function UsersTable({
                                       users = [],
                                       search = "",
                                       getCityColor = () => null,
                                       onVisibleCountChange = () => {},
                                       onVisibleRowsChange = () => {},
                                       onEdit,
                                       onDelete,
                                   }) {
    // UI state
    const [sortKey, setSortKey] = React.useState(null);
    const [sortAsc, setSortAsc] = React.useState(true);
    const [expanded, setExpanded] = React.useState(false);

    // signatures
    const [sigCount, setSigCount] = React.useState({});
    const [tokenPatch, setTokenPatch] = React.useState({});
    const [copiedUsers, setCopiedUsers] = React.useState({});
    const [loadingUsers, setLoadingUsers] = React.useState({});

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/signatures/status", { cache: "no-store" });
                if (!res.ok) return;
                const rows = await res.json();
                if (cancelled) return;
                const map = {};
                for (const r of rows) map[r.userId] = r._count?.userId ?? r.collected ?? 0;
                setSigCount(map);
            } catch {}
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // filter
    const filtered = React.useMemo(() => {
        const q = (search || "").trim().toLowerCase();
        if (!q) return Array.isArray(users) ? users : [];
        const src = Array.isArray(users) ? users : [];
        return src.filter((u) => {
            let hay = [
                u.first,
                u.last,
                u.address,
                u.apt,
                u.city,
                u.county,
                u.zip,
                u.state,
                u.phone,
                u.dislikes,
                u.medicaid ? "yes" : "no",
            ]
                .map((v) => (v == null ? "" : String(v)))
                .join(" ")
                .toLowerCase();
            if (u?.schedule) {
                const k = [
                    "monday",
                    "tuesday",
                    "wednesday",
                    "thursday",
                    "friday",
                    "saturday",
                    "sunday",
                ];
                hay +=
                    " " +
                    ["m", "t", "w", "th", "f", "sa", "su"]
                        .filter((_, i) => u.schedule[k[i]])
                        .join(" ");
            }
            return hay.includes(q);
        });
    }, [users, search]);

    React.useEffect(
        () => {
            onVisibleCountChange(filtered.length);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filtered.length]
    );

    // sort
    const sorted = React.useMemo(() => {
        if (!sortKey) return filtered;
        if (sortKey === "signatures") {
            const getCount = (u) => Number(sigCount[u.id] ?? 0);
            const arr = [...filtered].sort((a, b) => {
                const ca = getCount(a),
                    cb = getCount(b);
                const aHas = ca > 0 ? 1 : 0,
                    bHas = cb > 0 ? 1 : 0;
                if (aHas !== bHas) return bHas - aHas;
                if (ca !== cb) return cb - ca;
                const lastCmp = String(a.last ?? "").localeCompare(String(b.last ?? ""), undefined, {
                    sensitivity: "base",
                });
                if (lastCmp) return lastCmp;
                return String(a.first ?? "").localeCompare(String(b.first ?? ""), undefined, {
                    sensitivity: "base",
                });
            });
            return sortAsc ? arr.reverse() : arr;
        }
        const arr = [...filtered].sort((a, b) => {
            const av = (a?.[sortKey] ?? "").toString().toLowerCase();
            const bv = (b?.[sortKey] ?? "").toString().toLowerCase();
            if (av < bv) return sortAsc ? -1 : 1;
            if (av > bv) return sortAsc ? 1 : -1;
            return 0;
        });
        return arr;
    }, [filtered, sortKey, sortAsc, sigCount]);

    // provide current rows to page (for exports)
    React.useEffect(() => {
        onVisibleRowsChange(sorted);
    }, [sorted, onVisibleRowsChange]);

    // columns
    const baseCols = [
        { key: "name", label: "Name", sort: ["first", "last"] },
        { key: "sign", label: "SIGN", sort: ["signatures"] },
        { key: "address", label: "Address", sort: ["address"] },
        { key: "apt", label: "Apt", sort: ["apt"] },
        { key: "city", label: "City", sort: ["city"] },
        { key: "dislikes", label: "Dislikes", sort: ["dislikes"] },
        { key: "actions", label: "", sort: [] },
    ];
    const detailCols = [
        { key: "complex", label: "Complex", sort: ["complex"] },
        { key: "paused", label: "Paused", sort: ["paused"] },
        { key: "county", label: "County", sort: ["county"] },
        { key: "zip", label: "Zip", sort: ["zip"] },
        { key: "state", label: "State", sort: ["state"] },
        { key: "phone", label: "Phone", sort: ["phone"] },
        { key: "medicaid", label: "Medicaid", sort: ["medicaid"] },
        { key: "schedule", label: "Schedule", sort: ["schedule"] },
        { key: "geo", label: "Geo", sort: ["geo"] },
    ];
    const columns = expanded ? [...baseCols, ...detailCols] : baseCols;
    const baseCount = baseCols.length;

    const SortGlyph = ({ active }) =>
        active ? (
            sortAsc ? <ArrowUpwardIcon fontSize="inherit" /> : <ArrowDownwardIcon fontSize="inherit" />
        ) : (
            <UnfoldMoreIcon fontSize="inherit" />
        );

    const setSort = (k) => {
        setSortAsc((prev) => (k === sortKey ? !prev : true));
        setSortKey(k);
    };

    const wrap = {
        whiteSpace: "normal",
        wordBreak: "normal",
        overflowWrap: "break-word",
    };

    const SignCell = (u) => {
        const collected = sigCount[u.id] ?? 0;
        const done = collected >= 5;
        const isCopied = copiedUsers[u.id] || false;
        const isLoading = loadingUsers[u.id] || false;

        const ensureToken = async () => {
            try {
                const legacy = await fetch(`/api/signatures/ensure-token/${u.id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                });
                if (legacy.ok) return (await legacy.json()).sign_token ?? null;
                const body = await fetch(`/api/signatures/ensure-token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: u.id }),
                });
                const data = await body.json();
                return data.sign_token ?? data.signToken ?? data.token ?? null;
            } catch {
                return null;
            }
        };

        const onClick = async () => {
            if (isLoading) return;
            setLoadingUsers((p) => ({ ...p, [u.id]: true }));
            const token =
                tokenPatch[u.id] ??
                u.signToken ??
                u.sign_token ??
                u.token ??
                (await ensureToken());
            setLoadingUsers((p) => ({ ...p, [u.id]: false }));
            if (!token) return alert("Could not create a signature link. Try again.");

            const base = `${window.location.origin}/sign/${token}`;
            if (done) {
                const viewerUrl = `${base}/view`;
                try {
                    const head = await fetch(viewerUrl, { method: "HEAD" });
                    window.open(head.ok ? viewerUrl : base, "_blank", "noopener,noreferrer");
                } catch {
                    window.open(base, "_blank", "noopener,noreferrer");
                }
            } else {
                try {
                    await navigator.clipboard.writeText(base);
                    setCopiedUsers((p) => ({ ...p, [u.id]: true }));
                    setTimeout(() => setCopiedUsers((p) => ({ ...p, [u.id]: false })), 1800);
                } catch {
                    alert("Failed to copy link.");
                }
            }
        };

        return (
            <Tooltip
                title={done ? "View completed signatures" : isCopied ? "Link Copied!" : "Copy link"}
            >
                <IconButton size="small" onClick={onClick} aria-label="Sign link" disabled={isLoading}>
                    {isLoading ? (
                        <CircularProgress size={18} color="primary" />
                    ) : done || isCopied ? (
                        <DoneIcon sx={{ color: "#4caf50" }} fontSize="small" />
                    ) : (
                        <ContentCopyIcon sx={{ color: "#1976d2" }} fontSize="small" />
                    )}
                </IconButton>
            </Tooltip>
        );
    };

    /* =========================
       RENDER
       ========================= */
    return (
        // This Box is the ONLY scroll container (both axes)
        <Box
            sx={{
                width: "100%",
                height: "100%",
                overflow: "auto", // ← gives vertical + horizontal scrollbars as needed
            }}
        >
            <Box sx={{ minWidth: "100%" }}>
                <table
                    style={{
                        tableLayout: "auto",
                        width: "auto",
                        minWidth: "1200px",
                        borderCollapse: "separate",
                        borderSpacing: "12px 8px",
                    }}
                >
                    <thead>
                    {/* Sticky header inside THIS scroll container */}
                    <tr style={{ position: "sticky", top: 0, zIndex: 6 }}>
                        {[...baseCols, ...(expanded ? detailCols : [])].map((col, i) => {
                            const isShelfStart = expanded && i === baseCount;
                            const k = col.sort?.[0];
                            return (
                                <th
                                    key={col.key}
                                    onClick={k ? () => setSort(k) : undefined}
                                    title={k ? "Click to sort" : undefined}
                                    style={{
                                        position: "sticky",
                                        top: 0,
                                        background: "rgba(255,255,255,0.94)",
                                        backdropFilter: "saturate(180%) blur(6px)",
                                        border: "1px solid rgba(0,0,0,0.08)",
                                        padding: "10px 12px",
                                        fontWeight: 800,
                                        whiteSpace: "nowrap",
                                        cursor: k ? "pointer" : "default",
                                        verticalAlign: "bottom",
                                        boxShadow: "0 8px 14px rgba(0,0,0,0.06)",
                                        ...(isShelfStart ? { boxShadow: "inset 3px 0 0 #d8dee6" } : null),
                                    }}
                                >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {col.key === "actions" ? (
                          <Tooltip title={expanded ? "Collapse details" : "Expand details"}>
                              <IconButton
                                  size="small"
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      setExpanded((v) => !v);
                                  }}
                              >
                                  {expanded ? <CloseFullscreenIcon /> : <OpenInFullIcon />}
                              </IconButton>
                          </Tooltip>
                      ) : (
                          <>
                              {col.label}
                              {col.key === "name" && (
                                  <>
                                      <IconButton
                                          size="small"
                                          onClick={(e) => {
                                              e.stopPropagation();
                                              setSort("first");
                                          }}
                                          sx={{ p: 0.25 }}
                                      >
                                          {sortKey === "first" ? (
                                              sortAsc ? (
                                                  <ArrowUpwardIcon fontSize="inherit" />
                                              ) : (
                                                  <ArrowDownwardIcon fontSize="inherit" />
                                              )
                                          ) : (
                                              <UnfoldMoreIcon fontSize="inherit" />
                                          )}
                                          <span style={{ fontSize: 11, marginLeft: 2 }}>F</span>
                                      </IconButton>
                                      <IconButton
                                          size="small"
                                          onClick={(e) => {
                                              e.stopPropagation();
                                              setSort("last");
                                          }}
                                          sx={{ p: 0.25 }}
                                      >
                                          {sortKey === "last" ? (
                                              sortAsc ? (
                                                  <ArrowUpwardIcon fontSize="inherit" />
                                              ) : (
                                                  <ArrowDownwardIcon fontSize="inherit" />
                                              )
                                          ) : (
                                              <UnfoldMoreIcon fontSize="inherit" />
                                          )}
                                          <span style={{ fontSize: 11, marginLeft: 2 }}>L</span>
                                      </IconButton>
                                  </>
                              )}
                              {k && col.key !== "name" && (
                                  <IconButton
                                      size="small"
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          setSort(k);
                                      }}
                                      sx={{ p: 0.25 }}
                                  >
                                      {sortKey === k ? (
                                          sortAsc ? (
                                              <ArrowUpwardIcon fontSize="inherit" />
                                          ) : (
                                              <ArrowDownwardIcon fontSize="inherit" />
                                          )
                                      ) : (
                                          <UnfoldMoreIcon fontSize="inherit" />
                                      )}
                                  </IconButton>
                              )}
                          </>
                      )}
                    </span>
                                </th>
                            );
                        })}
                    </tr>
                    </thead>

                    <tbody>
                    {sorted.map((u) => {
                        const cityColor = getCityColor(u.city) || undefined;
                        const cells = {
                            name: (
                                <div style={{ ...wrap, fontWeight: 800 }}>
                                    {(u.first ?? "") + (u.last ? ` ${u.last}` : "")}
                                </div>
                            ),
                            sign: <div>{SignCell(u)}</div>,
                            address: <div style={wrap}>{u.address ?? ""}</div>,
                            apt: <div style={wrap}>{u.apt ?? ""}</div>,
                            city: (
                                <div style={{ ...wrap, color: cityColor || "inherit", fontWeight: 700 }}>
                                    {u.city ?? ""}
                                </div>
                            ),
                            dislikes: (
                                <div style={{ ...wrap, whiteSpace: "pre-wrap" }}>{u.dislikes ?? ""}</div>
                            ),
                            actions: (
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    <Button type="button" size="small" onClick={() => onEdit?.(u)} disabled={!onEdit}>
                                        Edit
                                    </Button>
                                    <Button
                                        type="button"
                                        size="small"
                                        color="error"
                                        onClick={() => onDelete?.(u.id)}
                                        disabled={!onDelete}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            ),
                            complex: <div style={wrap}>{u.complex ? "Yes" : "No"}</div>,
                            paused: <div style={wrap}>{u.paused ? "Yes" : "No"}</div>,
                            county: <div style={wrap}>{u.county ?? ""}</div>,
                            zip: <div style={wrap}>{u.zip ?? ""}</div>,
                            state: <div style={wrap}>{u.state ?? ""}</div>,
                            phone: <div style={wrap}>{u.phone ?? ""}</div>,
                            medicaid: <div style={wrap}>{u.medicaid ? "Yes" : "No"}</div>,
                            schedule: (
                                <div style={wrap}>
                                    {u.schedule
                                        ? ["M", "T", "W", "Th", "F", "Sa", "Su"]
                                            .filter((_, i) => {
                                                const k = [
                                                    "monday",
                                                    "tuesday",
                                                    "wednesday",
                                                    "thursday",
                                                    "friday",
                                                    "saturday",
                                                    "sunday",
                                                ];
                                                return u.schedule[k[i]];
                                            })
                                            .join(" ")
                                        : "—"}
                                </div>
                            ),
                            geo: (
                                <div style={wrap}>
                                    {(u.lat ?? u.latitude) != null && (u.lng ?? u.longitude) != null ? "✓" : "—"}
                                </div>
                            ),
                        };

                        return (
                            <tr key={u.id}>
                                {[...baseCols, ...(expanded ? detailCols : [])].map((c, i) => {
                                    const isShelfStart = expanded && i === baseCount;
                                    return (
                                        <td
                                            key={`${u.id}-${c.key}`}
                                            style={{
                                                background:
                                                    isShelfStart || (expanded && i > baseCount)
                                                        ? "linear-gradient(#fafafa,#fafafa)"
                                                        : "#fff",
                                                boxShadow: "0 1px 0 rgba(0,0,0,0.06) inset",
                                                border: "1px solid rgba(0,0,0,0.06)",
                                                padding: "10px 12px",
                                                verticalAlign: "top",
                                                minWidth: 120,
                                                ...(isShelfStart ? { boxShadow: "inset 3px 0 0 #d8dee6" } : null),
                                            }}
                                        >
                                            {cells[c.key]}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                    </tbody>
                </table>
            </Box>
        </Box>
    );
}
