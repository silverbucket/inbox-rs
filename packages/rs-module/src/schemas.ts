export const bookmarkSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['bookmark'] },
    title: { type: 'string' },
    description: { type: 'string' },
    url: { type: 'string' },
    favicon: { type: 'string' },
    ogImage: { type: 'string' },
    siteName: { type: 'string' },
    body: { type: 'string' },
    filePath: { type: 'string' },
    mimeType: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['id', 'type', 'title', 'url', 'createdAt']
};

export const noteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['note'] },
    title: { type: 'string' },
    description: { type: 'string' },
    body: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['id', 'type', 'title', 'body', 'createdAt']
};

export const imageMetaSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['image'] },
    title: { type: 'string' },
    description: { type: 'string' },
    filePath: { type: 'string' },
    mimeType: { type: 'string' },
    sourceUrl: { type: 'string' },
    createdAt: { type: 'string' }
  },
  required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt']
};

export const voiceMemoMetaSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['voice-memo'] },
    title: { type: 'string' },
    description: { type: 'string' },
    filePath: { type: 'string' },
    mimeType: { type: 'string' },
    duration: { type: 'number' },
    createdAt: { type: 'string' }
  },
  required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt']
};
