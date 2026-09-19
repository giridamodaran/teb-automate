import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TEB Webhook Lead Automation Engine",
  description: "Serverless Webhook Automation Service for TEB Cloud",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 0, background: "#0f172a", color: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}
