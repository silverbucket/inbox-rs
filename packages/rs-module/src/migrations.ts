import { createMigrator } from 'rs-migrate';

// Legacy schema for voice-memo-meta (needed so remoteStorage can read old items)
export const legacySchemas: Array<{ type: string; schema: object }> = [
  {
    type: 'voice-memo-meta',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string', enum: ['voice-memo'] },
        title: { type: 'string' },
        description: { type: 'string' },
        filePath: { type: 'string' },
        mimeType: { type: 'string' },
        duration: { type: 'number' },
        body: { type: 'string' },
        createdAt: { type: 'string' },
        isTodo: { type: 'boolean' },
        completed: { type: 'boolean' },
        completedAt: { type: 'string' },
      },
      required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt']
    },
  },
  {
    type: 'code-snippet',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string', enum: ['code-snippet'] },
        title: { type: 'string' },
        description: { type: 'string' },
        body: { type: 'string' },
        language: { type: 'string' },
        createdAt: { type: 'string' },
        isTodo: { type: 'boolean' },
        completed: { type: 'boolean' },
        completedAt: { type: 'string' },
        collectionId: { type: 'string' },
        _migrateVersion: { type: 'number' },
      },
      required: ['id', 'type', 'title', 'body', 'createdAt']
    },
  },
];

export const migrator = createMigrator();

export function wrapCodeBlock(body: unknown, language?: unknown): string {
  const text = typeof body === 'string' ? body : '';
  const lang = typeof language === 'string' ? language.trim() : '';
  const normalized = text.endsWith('\n') ? text : `${text}\n`;
  return `\`\`\`${lang}\n${normalized}\`\`\``;
}

migrator.register({
  version: 1,
  collection: 'items',
  description: 'Rename voice memos to audio',
  transform: (doc) => (doc.type === 'voice-memo' ? { ...doc, type: 'audio' } : doc),
});

migrator.register({
  version: 2,
  collection: 'items',
  description: 'Add optional collectionId field (no transform needed)',
  transform: (doc) => doc,
});

migrator.register({
  version: 3,
  collection: 'items',
  description: 'Convert code snippets into fenced notes',
  transform: (doc) => {
    if (doc.type !== 'code-snippet') return doc;
    const { language, body, ...rest } = doc as Record<string, unknown>;
    return {
      ...rest,
      type: 'note',
      body: wrapCodeBlock(body, language),
    };
  },
});
