/**
 * The flag defaults when the request carries None
 * A response may say None for the same reason
 * The reader treats None as the ordinary case
 */
export function read(value: string | undefined): string {
  return value ?? "None"
}
