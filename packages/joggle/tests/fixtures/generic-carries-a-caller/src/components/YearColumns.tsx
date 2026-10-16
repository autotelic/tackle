export function YearColumns({ totals }: { totals: ReadonlyArray<number> }) {
  return (
    <tfoot>
      <tr>
        <td>Company total</td>
        <td>{totals.reduce((sum, value) => sum + value, 0)}</td>
      </tr>
    </tfoot>
  )
}
