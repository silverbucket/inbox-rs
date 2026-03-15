/**
 * Extract plain text body from a MIME message part tree.
 * Prefers text/plain, falls back to text/html with tag stripping.
 */
export function extractTextBody(part: messenger.messages.MessagePart): string {
  if (part.contentType === 'text/plain' && part.body) {
    return part.body;
  }

  if (part.parts) {
    // First pass: look for text/plain
    for (const sub of part.parts) {
      const text = extractTextBody(sub);
      if (text) return text;
    }
    // Second pass: fall back to text/html
    for (const sub of part.parts) {
      if (sub.contentType === 'text/html' && sub.body) {
        return stripHtml(sub.body);
      }
    }
  }

  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
