export interface Migration {
  id: string;
  description: string;
  oldType: string;      // remoteStorage schema alias for legacy reads
  oldItemType: string;  // the item.type value to match
  newType: string;
  oldSchema?: object;   // schema to register so old items can be read
  transform: (item: any) => any;
}

// Legacy schema for voice-memo-meta (needed so remoteStorage can read old items)
const legacyVoiceMemoMetaSchema = {
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
};

export const migrations: Migration[] = [
  {
    id: 'voice-memo-to-audio',
    description: 'Rename voice memos to audio',
    oldType: 'voice-memo-meta',
    oldItemType: 'voice-memo',
    newType: 'audio-meta',
    oldSchema: legacyVoiceMemoMetaSchema,
    transform: (item: any) => ({ ...item, type: 'audio' }),
  },
];
