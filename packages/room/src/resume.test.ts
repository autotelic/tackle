import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  bodyHash,
  decodeCursor,
  emptyCursor,
  planResume,
  renderResume,
  type Observation,
} from "./resume.ts"

/*
 * The probes the testing session asked for, in order. The point of each is a failure mode we
 * have already paid for once: a cold start that replays everything, a resume that cannot see an
 * edit, a dismissal that goes quiet, and a lost cursor that claims all is well.
 */

const observation = (overrides: Partial<Observation> = {}): Observation => ({
  pr: 1776,
  headSha: "83fe79a31aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  reviews: [],
  comments: [],
  ...overrides,
})

const review = (
  id: number,
  state: string,
  commitId = "83fe79a31aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  body = "",
  submittedAt = "2026-11-03T17:58:08Z",
) => ({ id, state, commitId, body, author: "eadmundo", submittedAt })

const comment = (id: number, body: string, createdAt = "2026-11-03T17:58:09Z") => ({
  id,
  body,
  path: "a.ts",
  line: 4,
  author: "eadmundo",
  createdAt,
})

describe("room resume", () => {
  it("a: a cold start with nothing new says nothing new, not a replay", () => {
    const first = planResume({ observations: [observation()], cursor: undefined, now: 1 })
    const again = planResume({ observations: [observation()], cursor: first.next, now: 2 })
    expect(first.lost).toBe(true)
    expect(again.cards).toEqual([])
    expect(renderResume({ plan: again, applied: false })).toContain("nothing new")
  })

  it("b: a review and inline notes arrive as one card, with the stale head named", () => {
    const plan = planResume({
      observations: [
        observation({
          headSha: "3b51f361fbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          reviews: [
            review(
              11,
              "changes_requested",
              "cd26f3affccccccccccccccccccccccccccccccc",
              "fix the year key",
            ),
          ],
          comments: [comment(21, "year is nullable"), comment(22, "write order slipped")],
        }),
      ],
      cursor: undefined,
      now: 10,
    })
    expect(plan.cards).toHaveLength(1)
    const card = plan.cards[0]
    // A cold start reports the current round: the state, the sha it was written at, the head now,
    // and the notes after it. Not every review the PR ever had.
    expect(card?.text).toContain("cursor lost")
    expect(card?.text).toContain("latest: changes requested at cd26f3af")
    expect(card?.text).toContain("(head 3b51f361)")
    expect(card?.text).toContain("2 inline note(s) after it")
  })

  it("c: running it twice reports nothing the second time", () => {
    const first = planResume({
      observations: [observation({ reviews: [review(11, "approved")] })],
      cursor: emptyCursor,
      now: 1,
    })
    const second = planResume({
      observations: [observation({ reviews: [review(11, "approved")] })],
      cursor: first.next,
      now: 2,
    })
    expect(first.cards).toHaveLength(1)
    expect(second.cards).toEqual([])
  })

  it("d: a missing cursor is loud, never silent", () => {
    const plan = planResume({ observations: [observation()], cursor: undefined, now: 1 })
    expect(plan.lost).toBe(true)
    expect(renderResume({ plan, applied: false })).toContain("cursor lost")
  })

  it("e: an edited comment body is news even though the id is old and no timestamp moved", () => {
    const first = planResume({
      observations: [observation({ comments: [comment(21, "year is nullable")] })],
      cursor: emptyCursor,
      now: 1,
    })
    const edited = planResume({
      observations: [
        observation({ comments: [comment(21, "year is nullable, and the strip runs anyway")] }),
      ],
      cursor: first.next,
      now: 2,
    })
    expect(edited.cards).toHaveLength(1)
    expect(edited.cards[0]?.text).toContain("#21")
  })

  it("f: a dismissal keeps its id, so state is what the card reports", () => {
    const first = planResume({
      observations: [observation({ reviews: [review(11, "changes_requested")] })],
      cursor: emptyCursor,
      now: 1,
    })
    const dismissed = planResume({
      observations: [observation({ reviews: [review(11, "dismissed")] })],
      cursor: first.next,
      now: 2,
    })
    expect(dismissed.cards).toHaveLength(1)
    expect(dismissed.cards[0]?.text).toContain("dismissed")
  })

  it("an approval with inline notes is not done, and says so", () => {
    const plan = planResume({
      observations: [
        observation({ reviews: [review(12, "approved")], comments: [comment(23, "note")] }),
      ],
      cursor: emptyCursor,
      now: 1,
    })
    expect(plan.cards[0]?.text).toContain("approved")
    expect(plan.cards[0]?.text).toContain("1 inline note(s)")
  })

  it("reports a delta against a cursor as news, with the review state named", () => {
    const first = planResume({ observations: [observation()], cursor: emptyCursor, now: 1 })
    const next = planResume({
      observations: [observation({ reviews: [review(11, "changes_requested")] })],
      cursor: first.next,
      now: 2,
    })
    expect(next.cards[0]?.text).toContain("1 new review(s) (changes requested)")
    expect(next.cards[0]?.text).toContain("#11")
  })

  it("property: an unchanged observation is never news, however many ids there are", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 900 }), { maxLength: 20 }), (ids) => {
        const unique = [...new Set(ids)]
        const observed = observation({ comments: unique.map((id) => comment(id, "body")) })
        const first = planResume({ observations: [observed], cursor: emptyCursor, now: 1 })
        const again = planResume({ observations: [observed], cursor: first.next, now: 2 })
        return again.cards.length === 0
      }),
    )
  })

  it("keeps a body hash stable, and changes it when the body does", () => {
    expect(bodyHash("note")).toBe(bodyHash("note"))
    expect(bodyHash("note")).not.toBe(bodyHash("note "))
  })

  it("degrades an unreadable cursor to the empty one, and calls that lost", () => {
    expect(decodeCursor("not json")).toEqual(emptyCursor)
    expect(decodeCursor(JSON.stringify(emptyCursor))).toEqual(emptyCursor)
    const plan = planResume({ observations: [observation()], cursor: emptyCursor, now: 1 })
    expect(plan.lost).toBe(true)
  })
})
