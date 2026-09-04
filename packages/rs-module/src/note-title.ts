/** Generate a compact note title without pulling body text from later lines. */
export function noteTitleFromBody(body: string): string {
  return body.split(/\r\n?|\n/, 1)[0].slice(0, 50);
}
