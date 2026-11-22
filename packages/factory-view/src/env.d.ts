/// <reference types="vite/client" />

declare module "*.css" {}

/*
 * The view deliberately declares the tiny DOM surface it uses instead of pulling
 * in the whole browser typings: the copy fallback is the only code that reaches
 * for selection API, and `navigator.clipboard` is optional because iOS Safari
 * may not expose it.
 */
declare const document: {
  getElementById(id: string): HTMLElement
  querySelector(selector: string): HTMLElement | null
  createRange(): SelectionRange
}

interface HTMLElement {}

interface SelectionRange {
  selectNodeContents(node: HTMLElement): void
}

interface DomSelection {
  removeAllRanges(): void
  addRange(range: SelectionRange): void
}

declare const window: {
  getSelection(): DomSelection | null
}

declare const navigator: {
  readonly clipboard?: {
    readonly writeText?: (text: string) => Promise<void>
  }
}
