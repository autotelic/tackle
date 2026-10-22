import { expect, test } from "vitest"
import { stripJsonc } from "../src/jsonc.ts"

test("comments and trailing commas are removed, strings are left alone", () => {
  const text = `{
    // a line comment
    "url": "https://example.com/a//b",
    /* a block
       comment */
    "list": [1, 2,],
  }`
  expect(JSON.parse(stripJsonc(text))).toEqual({
    url: "https://example.com/a//b",
    list: [1, 2],
  })
})

test("a comma before a closing brace is trailing; one before a value is not", () => {
  expect(JSON.parse(stripJsonc(`{"a": 1, "b": 2,}`))).toEqual({ a: 1, b: 2 })
  expect(JSON.parse(stripJsonc(`{"a": 1, "b": 2}`))).toEqual({ a: 1, b: 2 })
})
