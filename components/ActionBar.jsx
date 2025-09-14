import React from "react";
import { Button, FormControl, InputLabel, MenuItem, Select } from "@mui/material";

export default function ActionBar({
                                      search, setSearch,
                                      selectedDay, setSelectedDay,
                                      onAdd, onExportExcel, onExportLabels, onExportClientList,
                                      onCityColors, onGeocodeMissing, onExportDrivers, setDriversModalOpen,
                                      total
                                  }) {
    return (
        <div
            style={{
                marginBottom: 12,
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
            }}
        >
            <input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ padding: 6, width: 240 }}
            />
            <span style={{ fontSize: 13, color: "#555" }}>
        Total: {total}
      </span>

            <Button variant="contained" onClick={onAdd}>Add User</Button>

            <FormControl size="small" style={{ minWidth: 160 }}>
                <InputLabel id="day-select-label">Day filter</InputLabel>
                <Select
                    labelId="day-select-label"
                    value={selectedDay}
                    label="Day filter"
                    onChange={(e) => setSelectedDay(e.target.value)}
                >
                    <MenuItem value="all">All days</MenuItem>
                    <MenuItem value="monday">Monday</MenuItem>
                    <MenuItem value="tuesday">Tuesday</MenuItem>
                    <MenuItem value="wednesday">Wednesday</MenuItem>
                    <MenuItem value="thursday">Thursday</MenuItem>
                    <MenuItem value="friday">Friday</MenuItem>
                    <MenuItem value="saturday">Saturday</MenuItem>
                    <MenuItem value="sunday">Sunday</MenuItem>
                </Select>
            </FormControl>

            <Button variant="outlined" onClick={onExportExcel}>Export Excel</Button>
            <Button variant="outlined" onClick={onExportLabels}>Export Labels PDF</Button>
            <Button variant="outlined" onClick={onExportClientList}>Client List PDF</Button>

            <Button variant="text" onClick={onCityColors}>City Colors</Button>
            <Button
                variant="outlined"

                onClick={() => setDriversModalOpen(true)}
            >
                Drivers
            </Button>
            {/*<Button variant="text" onClick={onGeocodeMissing}>Geocode Missing</Button>*/}
            {/*<Button variant="text" onClick={onExportDrivers}>Drivers PDF</Button>*/}
        </div>
    );
}