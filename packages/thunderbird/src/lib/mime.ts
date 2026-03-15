/**
 * Extract plain text body from a MIME message part tree.
 * Prefers text/plain, falls back to text/html with tag stripping.
 */
export function extractTextBody(part: messenger.messages.MessagePart): string {
  // First: search entire tree for text/plain only
  const plain = findPlainText(part);
  if (plain) return plain;

  // Second: fall back to text/html with tag stripping
  const html = findHtmlText(part);
  if (html) return stripHtml(html);

  return '';
}

function findPlainText(part: messenger.messages.MessagePart): string | null {
  if (part.contentType === 'text/plain' && part.body) {
    return part.body;
  }
  if (part.parts) {
    for (const sub of part.parts) {
      const text = findPlainText(sub);
      if (text) return text;
    }
  }
  return null;
}

function findHtmlText(part: messenger.messages.MessagePart): string | null {
  if (part.contentType === 'text/html' && part.body) {
    return part.body;
  }
  if (part.parts) {
    for (const sub of part.parts) {
      const html = findHtmlText(sub);
      if (html) return html;
    }
  }
  return null;
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
