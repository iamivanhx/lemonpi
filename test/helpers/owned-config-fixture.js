import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const shippedFiles = [
  'agents/explorer.md',
  'agents/implementer.md',
  'agents/merger.md',
  'agents/researcher.md',
  'agents/reviewer.md',
  'extensions/pi-footer.json',
];

export async function seedOwnedConfigFixture(fake, { defaultModel = true } = {}) {
  if (defaultModel) {
    const settings = await fake.readGlobalSettings();
    await fake.writeGlobalSettings({
      ...settings,
      defaultProvider: 'claude-code',
      defaultModel: 'claude-opus-5-5',
    });
  }
  for (const path of shippedFiles) {
    const contents = await readFile(new URL(`../../src/owned-config/shipped-content/${path}`, import.meta.url));
    const target = join(fake.piCodingAgentDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}
