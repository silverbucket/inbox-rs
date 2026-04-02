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
];

export const migrator = createMigrator();

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
