interface Props extends React.PropsWithChildren {
  className?: string
}

export function Table({ className = "", children = null }: Props) {
  return (
    <table className={className}>
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
}

function Cell({ isHeader = false, className = "", children = null }: CellProps) {
  return isHeader
    ? (<th className={className}>{children}</th>)
    : (<td className={className}>{children}</td>);
}

export function TableHeaderCell({ className = "", children = null }: Props) {
  return (
    <Cell isHeader className={className}>
      {children}
    </Cell>);
}

export function TableCell({ className = "", children = null }: Props) {
  return (
    <Cell className={className}>
      {children}
    </Cell>);
}

