import { useState } from "react"

/**
 * A page owning three pieces of state and many distinct elements. `facts.jsx`
 * records element names as a set, so the count is the number of DISTINCT names.
 */
export function Page() {
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(false)
  return (
    <Alpha>
      <Beta value={query} onChange={(event) => setQuery(event.target.value)} />
      <Gamma onClick={() => setOpen(!open)} />
      <Delta onClick={() => setPage(page + 1)} />
      <Epsilon>{query}</Epsilon>
      <Zeta>{page}</Zeta>
      <Eta>{String(open)}</Eta>
      <Theta />
      <Iota />
      <Kappa />
      <Lambda />
      <Mu />
      <Nu />
      <Xi />
      <Omicron />
      <Pi />
      <Rho />
    </Alpha>
  )
}
