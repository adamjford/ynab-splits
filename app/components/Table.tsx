import type { PropsWithChildren } from "react";

interface Props extends PropsWithChildren {
  className?: string;
}

export function Table({ className = "", children }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse text-left ${className}`}>{children}</table>
    </div>
  );
}

export function TableRow({ className = "", children }: Props) {
  return <tr className={`border-b last:border-0 ${className}`}>{children}</tr>;
}

interface CellProps extends Props {
  isHeader?: boolean;
  textAlign?: "left" | "center" | "right";
}

export function TableCell({ isHeader = false, className = "", textAlign = "left", children }: CellProps) {
  const Tag = isHeader ? "th" : "td";
  return <Tag className={`p-3 text-${textAlign} ${className}`}>{children}</Tag>;
}
