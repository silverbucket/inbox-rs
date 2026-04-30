declare module 'remotestorage-module-shares' {
  const SharesModule: {
    name: string;
    builder: (...args: unknown[]) => unknown;
  };
  export default SharesModule;
}
