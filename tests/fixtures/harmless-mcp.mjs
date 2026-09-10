// Local regression probe only: no network, account data, or manuscript access.
import fs from 'node:fs';
import readline from 'node:readline';
const marker = process.argv[2];
fs.appendFileSync(marker, 'started\n');
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'editor-harmless-probe', version: '1' } };
  if (message.method === 'tools/list') result = { tools: [{ name: 'harmless_echo', description: 'Return a fixed synthetic greeting.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] };
  if (message.method === 'tools/call') { fs.appendFileSync(marker, 'called\n'); result = { content: [{ type: 'text', text: 'synthetic greeting' }] }; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
});
input.on('close', () => process.exit(0));
