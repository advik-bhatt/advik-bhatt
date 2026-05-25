import { readFile, writeFile } from 'node:fs/promises';

const payloadPath = new URL('./generate-contribution-platformer.b64', import.meta.url);
const generatedPath = '/tmp/generate-contribution-platformer.mjs';
const payload = await readFile(payloadPath, 'utf8');
const source = Buffer.from(payload.replace(/\s+/g, ''), 'base64').toString('utf8');

await writeFile(generatedPath, source);
await import(`file://${generatedPath}`);
