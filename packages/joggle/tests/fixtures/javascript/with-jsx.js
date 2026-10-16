// JSX inside a `.js` file, which is legal under the configs most React apps use
// and which `lang: "js"` parses strictly enough to reject. This file is the
// reason the parser gets a second reading rather than a guess from the contents.
export function Card({ title, children }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  )
}
