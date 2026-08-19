import request from "@/utils/request";

export type DatabaseBackupInfo = {
  sourcePath?: string;
  backupPath?: string;
  fileName?: string;
  size: number;
  createdAt?: string;
  updatedAt?: string;
  sha256?: string;
  counts: Record<string, number>;
  healthy: boolean | null;
  warnings: string[];
};

export const getCurrentDatabaseInfo = () => {
  return request<DatabaseBackupInfo>({ method: "GET", url: "/database-backups/current" });
};

export const getDatabaseBackups = () => {
  return request<DatabaseBackupInfo[]>({ method: "GET", url: "/database-backups" });
};

export const createDatabaseBackup = () => {
  return request<DatabaseBackupInfo>({
    method: "POST",
    url: "/database-backups",
    timeout: 60000,
  });
};
