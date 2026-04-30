import type { PropsWithChildren } from "react";

interface Props extends React.PropsWithChildren {
  className?: string
}

export function Table({ className = "", children = null }: Props) {
  return (
    <table className={`text-start border-collapse ${className}`}>
      {children}
    </table>
  )
}

export function TableRow({ className = "", children = null }: Props) {
  return (
    <tr className={className}>
      {children}
    </tr>
  )
}

interface CellProps extends Props {
  isHeader?: boolean,
  textAlign?: string
}

export function TableCell({
  isHeader = false,
  className = "",
  textAlign = "start",
  children = null
}: CellProps) {
  const props = {
    className: `text-${textAlign} border-1 border-solid px-2 py-0.5 border-gray-500 ${className}`,
    children: children
  } as PropsWithChildren;

  return isHeader
    ? (<th {...props} />)
    : (<td {...props} />);
}
