export default function ErrorScreen() {
    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            background: "#fef2f2",
            color: "#b91c1c",
            textAlign: "center",
            padding: "2rem"
        }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: "bold" }}>Server Unreachable</h1>
            <p style={{ marginTop: "1rem" }}>
                We could not connect to the backend. Please check your connection and try again.
            </p>
        </div>
    );
}