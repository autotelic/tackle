/**
 * The optional flag is read from the request
 * None of these values is required, and the code names the flag
 */
export function readFlag(request: { readonly flag?: string }): string {
  return request.flag ?? "default"
}
