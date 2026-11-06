/** A printed type cut to the length a finding's help can carry. */
export const shortType = (value: string): string => value

/** Whether a path is a Markdown document. */
export const isMarkdown = (file: string): boolean => file.endsWith(".md")
