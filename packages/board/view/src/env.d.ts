/// <reference types="vite/client" />

declare module "*.css" {}

declare const document: { getElementById(id: string): HTMLElement }
interface HTMLElement {}
declare const navigator: { clipboard: { writeText(text: string): Promise<void> } }
