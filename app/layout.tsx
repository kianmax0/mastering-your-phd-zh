import type { Metadata } from "next";
import "./globals.css";

const siteUrl = "https://kianmax0.github.io/mastering-your-phd-zh/";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "掌控你的博士生涯 · 在线阅读",
    template: "%s · 掌控你的博士生涯",
  },
  description: "博士岁月及未来的生存与成功——中文在线读本。",
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "掌控你的博士生涯",
    title: "掌控你的博士生涯 · 在线阅读",
    description: "博士岁月及未来的生存与成功——中文在线读本。",
    images: [
      {
        url: `${siteUrl}og.png`,
        width: 1731,
        height: 909,
        alt: "《掌控你的博士生涯》在线读本",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "掌控你的博士生涯 · 在线阅读",
    description: "博士岁月及未来的生存与成功——中文在线读本。",
    images: [`${siteUrl}og.png`],
  },
  icons: {
    icon: `${siteUrl}book/images/cover.png`,
    shortcut: `${siteUrl}book/images/cover.png`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
