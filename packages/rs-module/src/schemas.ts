// Shared todo fields that can be added to any item
const todoFields = {
  isTodo: { type: 'boolean' },
  completed: { type: 'boolean' },
  completedAt: { type: 'string' },
};

// Shared collection field — any item can belong to a collection
const collectionFields = {
  collectionId: { type: 'string' },
};

// rs-migrate version stamp — must be in every item schema so remoteStorage persists it
const migrateFields = {
  _migrateVersion: { type: 'number' },
};

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
    createdAt: { type: 'string' },
    ...todoFields,
    ...collectionFields,
    ...migrateFields,
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
    createdAt: { type: 'string' },
    ...todoFields,
    ...collectionFields,
    ...migrateFields,
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
    createdAt: { type: 'string' },
    ...todoFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt']
};

export const audioMetaSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['audio'] },
    title: { type: 'string' },
    description: { type: 'string' },
    filePath: { type: 'string' },
    mimeType: { type: 'string' },
    duration: { type: 'number' },
    body: { type: 'string' },
    createdAt: { type: 'string' },
    ...todoFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt']
};

export const documentMetaSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['document'] },
    title: { type: 'string' },
    description: { type: 'string' },
    filePath: { type: 'string' },
    mimeType: { type: 'string' },
    fileSize: { type: 'number' },
    fileName: { type: 'string' },
    createdAt: { type: 'string' },
    ...todoFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt']
};

export const codeSnippetSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['code-snippet'] },
    title: { type: 'string' },
    description: { type: 'string' },
    body: { type: 'string' },
    language: { type: 'string' },
    createdAt: { type: 'string' },
    ...todoFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'body', 'createdAt']
};

export const emailSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['email'] },
    title: { type: 'string' },
    description: { type: 'string' },
    body: { type: 'string' },
    from: { type: 'string' },
    notes: { type: 'string' },
    messageUrl: { type: 'string' },
    createdAt: { type: 'string' },
    ...todoFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'body', 'createdAt']
};

export const appConfigSchema = {
  type: 'object',
  properties: {
    todosCollapsed: { type: 'boolean' },
    collectionsOrder: { type: 'array', items: { type: 'string' } },
  }
};

export const todoSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['todo'] },
    title: { type: 'string' },
    description: { type: 'string' },
    body: { type: 'string' },
    completed: { type: 'boolean' },
    completedAt: { type: 'string' },
    createdAt: { type: 'string' },
    ...collectionFields,
  },
  required: ['id', 'type', 'title', 'completed', 'createdAt']
};

export const collectionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    itemIds: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string' },
    color: { type: 'string' },
  },
  required: ['id', 'name', 'itemIds', 'createdAt']
};
