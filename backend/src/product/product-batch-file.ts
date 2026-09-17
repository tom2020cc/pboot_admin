import * as fs from 'fs';
import { createHash, randomUUID } from 'crypto';

export const databaseHash = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex');

// Replace only the database version we inspected, retaining the PHP user's access.
export function replaceBatchDatabase(
  file: string,
  original: Buffer,
  next: Buffer,
) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error('网站数据库不是普通文件');
  const assertUnchanged = () => {
    const current = fs.lstatSync(file);
    if (
      !current.isFile() ||
      current.ino !== stat.ino ||
      current.dev !== stat.dev ||
      current.uid !== stat.uid ||
      current.gid !== stat.gid ||
      current.mode !== stat.mode ||
      current.mtimeMs !== stat.mtimeMs ||
      current.ctimeMs !== stat.ctimeMs ||
      databaseHash(fs.readFileSync(file)) !== databaseHash(original)
    ) {
      throw new Error('PB 数据或权限已变化，未覆盖，请刷新后重试');
    }
  };
  assertUnchanged();
  const temporary = `${file}.batch-${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    created = true;
    fs.writeFileSync(descriptor, next);
    const staged = fs.fstatSync(descriptor);
    if (
      process.platform !== 'win32' &&
      (staged.uid !== stat.uid || staged.gid !== stat.gid)
    )
      fs.fchownSync(descriptor, stat.uid, stat.gid);
    fs.fchmodSync(descriptor, stat.mode & 0o7777);
    const preserved = fs.fstatSync(descriptor);
    if (
      process.platform !== 'win32' &&
      (preserved.uid !== stat.uid ||
        preserved.gid !== stat.gid ||
        preserved.mode !== stat.mode)
    ) {
      throw new Error('无法保留 PB 数据库权限，未覆盖');
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertUnchanged();
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
