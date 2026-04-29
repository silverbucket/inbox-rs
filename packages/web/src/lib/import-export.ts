import type {
  AppConfig,
  Collection,
  CollectionGroup,
  InboxItem,
  UserSettings,
} from '@inbox-rs/rs-module';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { get } from 'svelte/store';
import rs from './rs';
import { appConfig, collections, groups, items, userSettings } from './stores';

export interface ExportManifest {
  version: 1;
  exportedAt: string;
  items: Record<string, InboxItem>;
  collections: Record<string, Collection>;
  groups: Record<string, CollectionGroup>;
  appConfig: AppConfig;
  userSettings: UserSettings;
  files: Record<string, { mimeType: string }>;
}

export interface ExportProgress {
  phase: 'metadata' | 'files' | 'zipping';
  current: number;
  total: number;
}

export interface ImportProgress {
  phase: 'reading' | 'clearing' | 'restoring';
  current: number;
  total: number;
}

function getInbox() {
  return (rs as any).inbox;
}

export async function exportToZipBytes(
  onProgress?: (progress: ExportProgress) => void,
): Promise<Uint8Array> {
  const inbox = getInbox();
  if (!inbox) throw new Error('Storage not connected');

  onProgress?.({ phase: 'metadata', current: 0, total: 1 });

  const [allItems, allCollections, allGroups, config, settings] =
    await Promise.all([
      inbox.getAll() as Promise<Record<string, InboxItem>>,
      inbox.getAllCollections() as Promise<Record<string, Collection>>,
      inbox.getAllGroups() as Promise<Record<string, CollectionGroup>>,
      inbox.getConfig() as Promise<AppConfig>,
      inbox.getUserSettings() as Promise<UserSettings>,
    ]);

  onProgress?.({ phase: 'metadata', current: 1, total: 1 });

  // Collect items that have binary files
  const fileItems: { filePath: string; mimeType: string }[] = [];
  for (const item of Object.values(allItems)) {
    if (
      'filePath' in item &&
      item.filePath &&
      'mimeType' in item &&
      item.mimeType
    ) {
      fileItems.push({ filePath: item.filePath, mimeType: item.mimeType });
    }
  }

  // Fetch binary files — fail on errors to avoid incomplete backups
  const zipData: Record<string, Uint8Array> = {};
  const filesManifest: Record<string, { mimeType: string }> = {};
  const failedFiles: string[] = [];

  for (let i = 0; i < fileItems.length; i++) {
    const { filePath, mimeType } = fileItems[i];
    onProgress?.({ phase: 'files', current: i, total: fileItems.length });
    try {
      const file = await inbox.getFile(filePath);
      if (file?.data) {
        zipData[`files/${filePath}`] = new Uint8Array(file.data);
        filesManifest[filePath] = { mimeType };
      } else {
        failedFiles.push(filePath);
      }
    } catch (e) {
      failedFiles.push(filePath);
    }
  }

  if (failedFiles.length > 0) {
    throw new Error(
      `Export failed: ${failedFiles.length} file(s) could not be retrieved:\n${failedFiles.join('\n')}`,
    );
  }

  onProgress?.({
    phase: 'files',
    current: fileItems.length,
    total: fileItems.length,
  });

  const manifest: ExportManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    items: allItems,
    collections: allCollections,
    groups: allGroups,
    appConfig: config,
    userSettings: settings,
    files: filesManifest,
  };

  onProgress?.({ phase: 'zipping', current: 0, total: 1 });

  zipData['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(zipData);

  onProgress?.({ phase: 'zipping', current: 1, total: 1 });

  return zipped;
}

export async function exportAllData(
  onProgress?: (progress: ExportProgress) => void,
): Promise<Blob> {
  const zipped = await exportToZipBytes(onProgress);
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

export async function importFromZipBytes(
  data: Uint8Array,
  onProgress?: (progress: ImportProgress) => void,
): Promise<void> {
  const inbox = getInbox();
  if (!inbox) throw new Error('Storage not connected');

  onProgress?.({ phase: 'reading', current: 0, total: 1 });

  const unzipped = unzipSync(data);

  const manifestBytes = unzipped['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Invalid export file: missing manifest.json');
  }

  const manifest: ExportManifest = JSON.parse(strFromU8(manifestBytes));
  if (manifest.version !== 1) {
    throw new Error(`Unsupported export version: ${manifest.version}`);
  }

  onProgress?.({ phase: 'reading', current: 1, total: 1 });

  // Clear existing data
  const existingItems = get(items);
  const existingCollections = get(collections);
  const existingGroups = get(groups);
  const totalToRemove =
    Object.keys(existingItems).length +
    Object.keys(existingCollections).length +
    Object.keys(existingGroups).length;
  let removed = 0;

  onProgress?.({ phase: 'clearing', current: 0, total: totalToRemove });

  for (const [id, item] of Object.entries(existingItems)) {
    await inbox.remove(id, item);
    removed++;
    onProgress?.({ phase: 'clearing', current: removed, total: totalToRemove });
  }
  for (const id of Object.keys(existingCollections)) {
    await inbox.removeCollection(id);
    removed++;
    onProgress?.({ phase: 'clearing', current: removed, total: totalToRemove });
  }
  for (const id of Object.keys(existingGroups)) {
    await inbox.removeGroup(id);
    removed++;
    onProgress?.({ phase: 'clearing', current: removed, total: totalToRemove });
  }

  // Restore data: groups -> collections -> items
  const totalToRestore =
    Object.keys(manifest.groups).length +
    Object.keys(manifest.collections).length +
    Object.keys(manifest.items).length;
  let restored = 0;

  onProgress?.({ phase: 'restoring', current: 0, total: totalToRestore });

  for (const group of Object.values(manifest.groups)) {
    await inbox.storeGroup(group);
    restored++;
    onProgress?.({
      phase: 'restoring',
      current: restored,
      total: totalToRestore,
    });
  }

  for (const collection of Object.values(manifest.collections)) {
    await inbox.storeCollection(collection);
    restored++;
    onProgress?.({
      phase: 'restoring',
      current: restored,
      total: totalToRestore,
    });
  }

  for (const item of Object.values(manifest.items)) {
    let fileData: ArrayBuffer | undefined;
    if ('filePath' in item && item.filePath) {
      const zipPath = `files/${item.filePath}`;
      const bytes = unzipped[zipPath];
      if (bytes) {
        fileData = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      }
    }
    await inbox.store(item, fileData);
    restored++;
    onProgress?.({
      phase: 'restoring',
      current: restored,
      total: totalToRestore,
    });
  }

  // Restore config and settings (always write, even if empty, to clear old values)
  await inbox.setConfig(manifest.appConfig ?? {});
  await inbox.setUserSettings(manifest.userSettings ?? {});

  // Reload all stores
  const [allItems, allCollections, allGroups, config, settings] =
    await Promise.all([
      inbox.getAll() as Promise<Record<string, InboxItem>>,
      inbox.getAllCollections() as Promise<Record<string, Collection>>,
      inbox.getAllGroups() as Promise<Record<string, CollectionGroup>>,
      inbox.getConfig() as Promise<AppConfig>,
      inbox.getUserSettings() as Promise<UserSettings>,
    ]);
  items.set(allItems);
  collections.set(allCollections);
  groups.set(allGroups);
  appConfig.set(config);
  userSettings.set(settings);
}

export async function importAllData(
  file: File,
  onProgress?: (progress: ImportProgress) => void,
): Promise<void> {
  const buffer = await file.arrayBuffer();
  return importFromZipBytes(new Uint8Array(buffer), onProgress);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
