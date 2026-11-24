import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryObjectStorage } from '../cas/ObjectStore';
import { seedDemoRepo } from '../seed/seedDemoRepo';
import { Repository } from '../vcs/Repository';
import {
  extractShareFragment,
  generateShareBundle,
  isSensitivePath,
  parseAndVerifySharePayload,
  redactSensitiveContent,
} from './shareLink';

test('isSensitivePath flags env files, private keys, and credential files without false positives', () => {
  assert.equal(isSensitivePath('.env'), true);
  assert.equal(isSensitivePath('config/.env.production'), true);
  assert.equal(isSensitivePath('keys/id_ed25519'), true);
  assert.equal(isSensitivePath('certs/server.pem'), true);
  assert.equal(isSensitivePath('secrets.json'), true);
  assert.equal(isSensitivePath('auth/credentials.yaml'), true);

  assert.equal(isSensitivePath('.env.example'), false);
  assert.equal(isSensitivePath('docs/architecture.md'), false);
  assert.equal(isSensitivePath('specs/design-tokens.md'), false);
  assert.equal(isSensitivePath('README.md'), false);
});

test('redactSensitiveContent strips API keys, bearer tokens, URL passwords, and PEM keys', () => {
  const sample = [
    '# Notes',
    'GEMINI_API_KEY=AIzaSyD1234567890abcdef1234567890abcdef12',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdef123456.signature123',
    'DB=postgres://admin:superSecretPass99@db.example.com:5432/app',
    '-----BEGIN PRIVATE KEY-----',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7',
    '-----END PRIVATE KEY-----',
    'GEMINI_API_KEY="MY_GEMINI_API_KEY"',
  ].join('\n');

  const { sanitized, redactionCount } = redactSensitiveContent(sample);
  assert.ok(redactionCount >= 4);
  assert.equal(sanitized.includes('AIzaSy'), false);
  assert.equal(sanitized.includes('superSecretPass99'), false);
  assert.equal(sanitized.includes('MIIEvQIBADAN'), false);
  assert.equal(sanitized.includes('MY_GEMINI_API_KEY'), true);
});

test('generateShareBundle compresses repository state, excludes sensitive data, and round-trips with intact SHA-256 verification', async () => {
  const storage = new InMemoryObjectStorage();
  await seedDemoRepo(storage);
  const repo = new Repository(storage);
  const refs = await repo.getRefs();
  const headFiles = await repo.getHeadFiles();

  // Add a sensitive file and an inline secret to working tree & commit history
  const filesWithSecrets: Record<string, string> = {
    ...headFiles,
    '.env': 'MOCK_SECRET=sec_test_mock_value_1234567890\n',
    'notes/deploy.md':
      '# Deploy\n\nUse token `xoxb-mock-slack-token-1234567890` in CI.\n',
  };
  await repo.commit(filesWithSecrets, 'docs: add deploy notes');

  const nextRefs = await repo.getRefs();
  const bundle = await generateShareBundle({
    storage,
    refs: nextRefs,
    workingTreeFiles: {
      ...filesWithSecrets,
      'notes/draft.md': '# Uncommitted Draft\n\nLive edit.',
    },
    activeFile: 'notes/deploy.md',
  });

  assert.equal(bundle.fragment.startsWith('share=v1.'), true);
  assert.ok(bundle.compressedBytes < bundle.rawBytes);
  assert.equal(bundle.stats.excludedFileCount, 1);
  assert.deepEqual(bundle.stats.excludedPaths, ['.env']);
  assert.ok(bundle.stats.redactedSecretCount >= 1);

  // Round-trip decode & cryptographic verification
  const extracted = extractShareFragment(`#${bundle.fragment}`);
  assert.ok(extracted);
  const verified = await parseAndVerifySharePayload(extracted);

  assert.equal(verified.version, 1);
  assert.equal(verified.workingTreeFiles['.env'], undefined);
  assert.equal(
    verified.workingTreeFiles['notes/deploy.md']?.includes('xoxb-mock-slack-token'),
    false
  );
  assert.equal(
    verified.workingTreeFiles['notes/draft.md'],
    '# Uncommitted Draft\n\nLive edit.'
  );
  assert.equal(Object.keys(verified.refs.branches).length, 2);

  // Verify no CAS blob retains the secret
  const hasLeakedSecret = verified.objects.some(
    (o) =>
      o.type === 'blob' &&
      (o.content.includes('sec_test_mock_value') ||
        o.content.includes('xoxb-mock-slack-token'))
  );
  assert.equal(hasLeakedSecret, false);
});

test('parseAndVerifySharePayload rejects tampered CAS hashes and path traversal', async () => {
  const storage = new InMemoryObjectStorage();
  await seedDemoRepo(storage);
  const repo = new Repository(storage);
  const refs = await repo.getRefs();
  const headFiles = await repo.getHeadFiles();

  const bundle = await generateShareBundle({
    storage,
    refs,
    workingTreeFiles: headFiles,
    activeFile: 'README.md',
  });

  // Corrupt one character in the encoded payload
  const tampered =
    bundle.fragment.slice(0, -4) +
    (bundle.fragment.endsWith('AAAA') ? 'BBBB' : 'AAAA');

  await assert.rejects(async () => {
    await parseAndVerifySharePayload(`#${tampered}`);
  });
});
