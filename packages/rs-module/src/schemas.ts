// Shared todo fields that can be added to any item
const todoFields = {
  isTodo: { type: 'boolean' },
  completed: { type: 'boolean' },
  completedAt: { type: 'string' },
};

// Shared priority field — any active todo or reference can be pinned first.
const priorityFields = {
  pinned: { type: 'boolean' },
};

// Shared collection field — any item can belong to a collection.
const collectionFields = {
  collectionId: { type: 'string' },
};

// Shared scheduling fields — any item can carry a calendar time.
// See InboxItemBase in types.ts for semantics.
const scheduleFields = {
  startsAt: { type: 'string' },
  endsAt: { type: 'string' },
  allDay: { type: 'boolean' },
  scheduleKind: { type: 'string', enum: ['event', 'task'] },
  eventUrl: { type: 'string' },
  eventEtag: { type: 'string' },
  archived: { type: 'boolean' },
  archivedAt: { type: 'string' },
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
    ...priorityFields,
    ...scheduleFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'url', 'createdAt'],
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
    ...priorityFields,
    ...scheduleFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'body', 'createdAt'],
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
    thumbPath: { type: 'string' },
    thumbMimeType: { type: 'string' },
    createdAt: { type: 'string' },
    ...todoFields,
    ...priorityFields,
    ...scheduleFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt'],
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
    transcribed: { type: 'boolean' },
    createdAt: { type: 'string' },
    ...todoFields,
    ...priorityFields,
    ...scheduleFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt'],
};

export const videoMetaSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['video'] },
    title: { type: 'string' },
    description: { type: 'string' },
    filePath: { type: 'string' },
    mimeType: { type: 'string' },
    duration: { type: 'number' },
    body: { type: 'string' },
    createdAt: { type: 'string' },
    ...todoFields,
    ...priorityFields,
    ...scheduleFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt'],
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
    ...priorityFields,
    ...scheduleFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'filePath', 'mimeType', 'createdAt'],
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
    ...priorityFields,
    ...scheduleFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'body', 'createdAt'],
};

export const userSettingsSchema = {
  type: 'object',
  properties: {
    abbreviation: { type: 'string' },
    theme: { type: 'string', enum: ['system', 'light', 'dark'] },
    linkPreviews: { type: 'boolean' },
    sockethubUrl: { type: 'string' },
    calendarPostMode: { type: 'string', enum: ['move', 'copy'] },
  },
};

export const appConfigSchema = {
  type: 'object',
  properties: {
    todosCollapsed: { type: 'boolean' },
    collectionsOrder: { type: 'array', items: { type: 'string' } },
    groupsOrder: { type: 'array', items: { type: 'string' } },
    todosOrder: { type: 'array', items: { type: 'string' } },
    expandedCollections: { type: 'array', items: { type: 'string' } },
    activeGroupFilters: { type: 'array', items: { type: 'string' } },
    todosGlobalOrder: { type: 'array', items: { type: 'string' } },
    completedTodosExpanded: { type: 'boolean' },
  },
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
    ...priorityFields,
    createdAt: { type: 'string' },
    ...scheduleFields,
    ...collectionFields,
    ...migrateFields,
  },
  required: ['id', 'type', 'title', 'completed', 'createdAt'],
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
    groupId: { type: 'string' },
  },
  required: ['id', 'name', 'itemIds', 'createdAt'],
};

export const collectionGroupSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    collectionIds: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string' },
    color: { type: 'string' },
  },
  required: ['id', 'name', 'collectionIds', 'createdAt'],
};
