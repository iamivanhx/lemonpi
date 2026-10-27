import { readFile } from 'node:fs/promises';

// Shipped files are package data, separate from machine-state filesystem access.
export function readShippedContent(descriptor) {
  return readFile(descriptor.source);
}
