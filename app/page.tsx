import type { Metadata } from "next";
import Reader from "./Reader";

export const metadata: Metadata = {
  title: "在线阅读",
  description: "在线阅读《掌控你的博士生涯：博士岁月及未来的生存与成功》。",
};

export default function Home() {
  return <Reader />;
}
