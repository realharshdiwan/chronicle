import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { InMemoryObjectStorage } from '../cas/ObjectStore';
import { seedDemoRepo } from '../seed/seedDemoRepo';
import {
  buildRepoArchive,
  buildRepoZipBytes,
  importFromUploadedFiles,
  parseAndVerifyRepoArchiveJSON,
  serializeRepoArchiveJSON,
} from './repoArchive';

test('repoArchive JSON and ZIP round-trip full Merkle-DAG and working tree faithfully', async () => {
  const storage = new InMemoryObjectStorage();
  await seedDemoRepo(storage);
  const refs = (await storage.getRefs())!;
  const workingTreeFiles = {
    'README.md': '# Updated draft\n',
    'notes/todo.md': '- Verify archive export\n',
  };

  const archive = await buildRepoArchive({
    storage,
    refs,
    workingTreeFiles,
    activeFile: 'notes/todo.md',
    workspaceName: 'Engineering Notes',
  });

  const json = serializeRepoArchiveJSON(archive);
  const verifiedFromJson = await parseAndVerifyRepoArchiveJSON(json);
  assert.equal(verifiedFromJson.workspaceName, 'Engineering Notes');
  assert.equal(verifiedFromJson.objects.length, archive.objects.length);
  assert.equal(verifiedFromJson.workingTreeFiles['notes/todo.md'], '- Verify archive export\n');

  const zipBytes = buildRepoZipBytes(archive);
  const importedZip = await importFromUploadedFiles([
    { path: 'engineering-notes.zip', bytes: zipBytes },
  ]);
  assert.equal(importedZip.kind, 'archive');
  if (importedZip.kind === 'archive') {
    assert.equal(importedZip.archive.objects.length, archive.objects.length);
    assert.equal(importedZip.archive.activeFile, 'notes/todo.md');
  }
});

test('parseAndVerifyRepoArchiveJSON rejects tampered CAS blob payloads', async () => {
  const storage = new InMemoryObjectStorage();
  await seedDemoRepo(storage);
  const refs = (await storage.getRefs())!;
  const archive = await buildRepoArchive({
    storage,
    refs,
    workingTreeFiles: { 'README.md': '# Clean' },
    activeFile: 'README.md',
    workspaceName: 'Test',
  });

  const tampered = structuredClone(archive);
  const blobIdx = tampered.objects.findIndex((o) => o.type === 'blob');
  if (tampered.objects[blobIdx].type === 'blob') {
    tampered.objects[blobIdx].content += '\nTAMPERED';
  }

  await assert.rejects(
    parseAndVerifyRepoArchiveJSON(JSON.stringify(tampered)),
    /SHA-256 verification/
  );
});

test('importFromUploadedFiles imports plain ZIP and multi-file dropped Markdown folders safely', async () => {
  const plainZip = zipSync({
    'docs-folder/intro.md': strToU8('# Intro\n'),
    'docs-folder/nested/guide.md': strToU8('# Guide\n'),
    'docs-folder/binary.bin': new Uint8Array([0, 1, 2, 0, 255]),
  });

  const zipResult = await importFromUploadedFiles([
    { path: 'bundle.zip', bytes: plainZip },
  ]);
  assert.equal(zipResult.kind, 'files');
  if (zipResult.kind === 'files') {
    assert.equal(zipResult.files['intro.md'], '# Intro\n');
    assert.equal(zipResult.files['nested/guide.md'], '# Guide\n');
    assert.equal(zipResult.skippedCount, 1);
  }

  const droppedFiles = await importFromUploadedFiles([
    { path: 'my-vault/notes/one.md', bytes: strToU8('# One\n') },
    { path: 'my-vault/.git/HEAD', bytes: strToU8('ref: refs/heads/main') },
    { path: 'my-vault/notes/two.md', bytes: strToU8('# Two\n') },
  ]);
  assert.equal(droppedFiles.kind, 'files');
  if (droppedFiles.kind === 'files') {
    assert.equal(droppedFiles.files['notes/one.md'], '# One\n');
    assert.equal(droppedFiles.files['notes/two.md'], '# Two\n');
    assert.equal(droppedFiles.skippedCount, 1);
  }
});
