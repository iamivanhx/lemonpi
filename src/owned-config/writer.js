import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

async function saveBackup(ctx, relativePath, bytes, stamp) {
  const backupRoot = join(ctx.agentDir, 'lemonpi-backups');
  const runDirectory = join(backupRoot, stamp);
  const backupPath = join(runDirectory, relativePath);
  const directories = [backupRoot, runDirectory];
  let directory = runDirectory;
  for (const component of relativePath.split('/').slice(0, -1)) {
    directory = join(directory, component);
    directories.push(directory);
  }

  await ctx.mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  for (const path of directories) await ctx.chmod(path, 0o700);
  await atomicWrite(ctx, backupPath, bytes, 0o600);
}

async function atomicWrite(ctx, target, bytes, mode) {
  await ctx.mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${basename(target)}.lemonpi-${randomUUID()}.tmp`);
  try {
    await ctx.writeFile(temporary, bytes);
    if (mode !== undefined) await ctx.chmod(temporary, mode & 0o7777);
    await ctx.rename(temporary, target);
  } catch (error) {
    try {
      await ctx.rm(temporary);
    } catch {
      // Preserve the write/rename failure; the shell must not expose adapter details.
    }
    throw error;
  }
}

export async function writeOwnedFile(ctx, {
  target,
  relativePath,
  bytes,
  mode,
  backupBytes,
  backupStamp,
}) {
  if (backupBytes !== undefined) {
    try {
      await saveBackup(ctx, relativePath, backupBytes, backupStamp);
    } catch (error) {
      return { type: 'backup-failed', error };
    }
  }

  try {
    await atomicWrite(ctx, target, bytes, mode);
  } catch (error) {
    return { type: 'write-failed', error };
  }
  return { type: 'written' };
}
