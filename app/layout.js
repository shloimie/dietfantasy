import "./globals.css";
export const metadata = {
    title: {
        default: "Diet Fantasy Dashboard",
        template: "%s | Diet Fantasy",
    },
    description: "Smart delivery route optimizer",
};
export default function RootLayout({ children }) {
  return (
      <html lang="en">

      <body>
      <div className="container">{children}</div>
      </body>
      </html>
  );
}