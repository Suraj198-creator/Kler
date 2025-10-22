import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kler - AI Documentation Assistant",
  description: "Chat with API docs and GitHub SDKs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}