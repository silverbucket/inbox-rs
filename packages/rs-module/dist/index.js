import { bookmarkSchema, noteSchema, imageMetaSchema, audioMetaSchema, documentMetaSchema, codeSnippetSchema, todoSchema, emailSchema, appConfigSchema } from './schemas.js';
import { migrator, legacySchemas } from './migrations.js';
export { migrator } from './migrations.js';
const InboxModule = {
    name: 'inbox',
    builder: (privateClient) => {
        privateClient.declareType('bookmark', bookmarkSchema);
        privateClient.declareType('note', noteSchema);
        privateClient.declareType('image-meta', imageMetaSchema);
        privateClient.declareType('audio-meta', audioMetaSchema);
        privateClient.declareType('document-meta', documentMetaSchema);
        // Register legacy schemas so old items can still be read for migration
        for (const ls of legacySchemas) {
            privateClient.declareType(ls.type, ls.schema);
        }
        privateClient.declareType('code-snippet', codeSnippetSchema);
        privateClient.declareType('todo', todoSchema);
        privateClient.declareType('email', emailSchema);
        privateClient.declareType('app-config', appConfigSchema);
        return {
            exports: {
                async getAll() {
                    const items = await privateClient.getAll('items/');
                    return items || {};
                },
                async getById(id) {
                    return privateClient.getObject(`items/${id}`);
                },
                async store(item, fileData) {
                    if (fileData && 'filePath' in item && item.filePath && 'mimeType' in item && item.mimeType) {
                        // Store file locally for immediate access
                        const bytes = new Uint8Array(fileData);
                        let binaryString = '';
                        for (let i = 0; i < bytes.length; i++) {
                            binaryString += String.fromCharCode(bytes[i]);
                        }
                        await privateClient.storeFile(item.mimeType, item.filePath, binaryString);
                        // Also PUT directly to remote — remotestoragejs sync has a bug
                        // where it silently fails to push binary file bodies to the server.
                        const remote = privateClient.storage.remote;
                        if (remote?.connected) {
                            const fullPath = '/inbox/' + item.filePath;
                            try {
                                // Send the original ArrayBuffer, not the binary string —
                                // fetch encodes strings as UTF-8, corrupting bytes > 127
                                await remote.put(fullPath, fileData, item.mimeType);
                                console.log('[rs-module] direct PUT succeeded:', fullPath);
                            }
                            catch (e) {
                                console.warn('[rs-module] direct PUT failed:', fullPath, e);
                            }
                        }
                    }
                    const typeAlias = item.type === 'audio' ? 'audio-meta'
                        : item.type === 'image' ? 'image-meta'
                            : item.type === 'document' ? 'document-meta'
                                : item.type;
                    await privateClient.storeObject(typeAlias, `items/${item.id}`, item);
                },
                async remove(id, item) {
                    if (item && 'filePath' in item && item.filePath) {
                        await privateClient.remove(item.filePath);
                    }
                    await privateClient.remove(`items/${id}`);
                },
                async getFile(path) {
                    const file = await privateClient.getFile(path);
                    if (!file?.data)
                        return undefined;
                    // remotestoragejs may return a binary string; convert to ArrayBuffer
                    if (typeof file.data === 'string') {
                        const bytes = new Uint8Array(file.data.length);
                        for (let i = 0; i < file.data.length; i++) {
                            bytes[i] = file.data.charCodeAt(i);
                        }
                        return { data: bytes.buffer, mimeType: file.mimeType || file.contentType };
                    }
                    return { data: file.data, mimeType: file.mimeType || file.contentType };
                },
                async getConfig() {
                    return (await privateClient.getObject('config/app')) || {};
                },
                async setConfig(config) {
                    await privateClient.storeObject('app-config', 'config/app', config);
                },
                onChange(handler) {
                    privateClient.on('change', handler);
                },
                async runAllMigrations() {
                    return migrator.migrateAll('items', {
                        getAll: () => privateClient.getAll('items/').then((r) => r || {}),
                        save: async (key, doc) => {
                            const typeAlias = doc.type === 'audio' ? 'audio-meta'
                                : doc.type === 'image' ? 'image-meta'
                                    : doc.type === 'document' ? 'document-meta'
                                        : doc.type;
                            await privateClient.storeObject(typeAlias, `items/${key}`, doc);
                        },
                    });
                }
            }
        };
    }
};
export default InboxModule;
