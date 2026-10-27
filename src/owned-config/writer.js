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
    await ctx.writeFile(temporary, bytes, { mode: 0o600 });
    const finalMode = mode === undefined ? 0o666 & ~process.umask() : mode & 0o7777;
    await ctx.chmod(temporary, finalMode);
    await ctx.rename(temporary, target);
  } catch (error) {
    try {
      await ctx.rm(temporary);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Atomic write and cleanup failed for ${target}`, { cause: error });
    }
    // Filesystem errors retain their operation/path context for the item boundary.
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
  if (ctx.signal.aborted) return { type: 'interrupted' };
  if (backupBytes !== undefined) {
    try {
      await saveBackup(ctx, relativePath, backupBytes, backupStamp);
    } catch (error) {
      // Item boundary: a failed backup forbids overwriting the target.
      return { type: 'backup-failed', error };
    }
  }

  // A backup may finish after cancellation, but the target write must not start.
  if (ctx.signal.aborted) return { type: 'interrupted' };
  try {
    await atomicWrite(ctx, target, bytes, mode);
  } catch (error) {
    // Item boundary: report the write failure without exposing file contents.
    return { type: 'write-failed', error };
  }
  return { type: 'written' };
}
