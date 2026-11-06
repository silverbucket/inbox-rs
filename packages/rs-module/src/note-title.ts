const TITLE_MAX = 50;

/** Cap a derived title at 50 characters, marking a cut with "…". */
export function truncateTitle(text: string): string {
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text;
}

/** Generate a compact note title without pulling body text from later lines. */
export function noteTitleFromBody(body: string): string {
  return truncateTitle(body.split(/\r\n?|\n/, 1)[0]);
}
