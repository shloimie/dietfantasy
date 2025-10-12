// app/drivers/layout.jsx
import "../globals.css";
export const metadata = {
    title: "Delivery Drivers",
   
};

export default function DriversLayout({ children }) {
    return (
        <div
            // style={{
            //     maxWidth: 640,
            //     margin: "0 auto",
            //     minHeight: "100dvh",
            //     padding: 12,
            //     background: "#f6f7f9",
            //     color: "#111",
            // }}
        >
            {children}
        </div>
    );
}