/** GitHub Actions workflow-command helpers shared by the publish scripts. */

// Workflow commands treat %, \r and \n specially in the message.
function escapeData(message) {
  return String(message)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

export function notice(message) {
  console.log(`::notice::${escapeData(message)}`);
}

export function warning(message) {
  console.log(`::warning::${escapeData(message)}`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read a JSON body if there is one, otherwise the raw text. */
export async function readBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
