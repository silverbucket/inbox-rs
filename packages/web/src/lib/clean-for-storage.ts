/** Deep-clone an object, stripping undefined values for remoteStorage schema compatibility. */
export function cleanForStorage<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
