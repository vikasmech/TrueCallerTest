export type StorageProvider = {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  presignGet(key: string, expiresInSeconds: number, downloadName: string): Promise<string>;
};
