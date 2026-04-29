import type { Route } from "./+types/home";
import { TransactionSplitter } from "~/split/TransactionSplitter";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "YNAB Splits" },
    { name: "description", content: "Welcome to YNAB Splits!" },
  ];
}

export default function Home() {
  return <TransactionSplitter />;
}
