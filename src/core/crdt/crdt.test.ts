import test from 'node:test';
import assert from 'node:assert/strict';
import type { ISyncTransport } from '../types';
import { CHECKOUT_ORIGIN, LOCAL_EDIT_ORIGIN } from './origins';
import { TabSyncBridge } from './TabSyncBridge';
import { FileUndoManager } from './undo';
import { WorkingTreeDoc } from './WorkingTreeDoc';

class InMemoryBusTransport implements ISyncTransport {
  private hub: Set<(msg: unknown) => void>;
  private listener: ((msg: unknown) => void) | null = null;

  constructor(hub: Set<(msg: unknown) => void>) {
    this.hub = hub;
  }

  send(message: unknown): void {
    for (const fn of this.hub) {
      if (fn !== this.listener) {
        fn(message);
      }
    }
  }

  subscribe(handler: (message: unknown) => void): () => void {
    this.listener = handler;
    this.hub.add(handler);
    return () => {
      this.hub.delete(handler);
      this.listener = null;
    };
  }

  close(): void {
    if (this.listener) {
      this.hub.delete(this.listener);
      this.listener = null;
    }
  }
}

test('WorkingTreeDoc hydrates atomically and isolates per-file FileUndoManager from checkout', () => {
  const wt = new WorkingTreeDoc({ enablePersistence: false });
  const undo = new FileUndoManager(wt.doc, wt.filesMap);

  wt.hydrateFromTree({ 'a.md': 'initial', 'b.md': 'other' });
  assert.equal(undo.canUndo('a.md'), false);

  wt.updateFileContent('a.md', 'initial edited', LOCAL_EDIT_ORIGIN);
  assert.equal(wt.getFileMap()['a.md'], 'initial edited');
  assert.equal(undo.canUndo('a.md'), true);

  assert.equal(undo.undo('a.md'), true);
  assert.equal(wt.getFileMap()['a.md'], 'initial');
  assert.equal(undo.canRedo('a.md'), true);

  assert.equal(undo.redo('a.md'), true);
  assert.equal(wt.getFileMap()['a.md'], 'initial edited');

  // Checkout clears undo stacks
  wt.doc.transact(() => {
    wt.filesMap.get('a.md')?.delete(0, wt.filesMap.get('a.md')!.length);
    wt.filesMap.get('a.md')?.insert(0, 'branch-b');
  }, CHECKOUT_ORIGIN);

  assert.equal(undo.canUndo('a.md'), false);

  undo.destroy();
  wt.destroy();
});

test('TabSyncBridge converges two WorkingTreeDoc instances via handshake and live updates without loops', () => {
  const hub = new Set<(msg: unknown) => void>();

  const tabA = new WorkingTreeDoc({ enablePersistence: false });
  const tabB = new WorkingTreeDoc({ enablePersistence: false });

  tabA.hydrateFromTree({ 'notes.md': 'Hello' });

  let branchReceived: string | null = null;
  const bridgeA = new TabSyncBridge(tabA.doc, {
    transport: new InMemoryBusTransport(hub),
  });
  const bridgeB = new TabSyncBridge(tabB.doc, {
    transport: new InMemoryBusTransport(hub),
    onBranchChange: (branch) => {
      branchReceived = branch;
    },
  });

  // Handshake immediately syncs existing state to tabB
  assert.equal(tabB.getFileMap()['notes.md'], 'Hello');

  // Live edit in tabB propagates to tabA
  tabB.updateFileContent('notes.md', 'Hello World', LOCAL_EDIT_ORIGIN);
  assert.equal(tabA.getFileMap()['notes.md'], 'Hello World');

  // Branch broadcast reaches tabB
  bridgeA.broadcastBranchChange('feat/sync-protocol', 'abc123');
  assert.equal(branchReceived, 'feat/sync-protocol');

  bridgeA.destroy();
  bridgeB.destroy();
  tabA.destroy();
  tabB.destroy();
});

test('WorkingTreeDoc.renameFile moves file atomically and rejects invalid/duplicate paths', () => {
  const wt = new WorkingTreeDoc({ enablePersistence: false });
  wt.hydrateFromTree({ 'notes/old.md': '# Title\nBody', 'other.md': 'keep' });

  wt.renameFile('notes/old.md', 'docs/new.md');
  const map = wt.getFileMap();
  assert.equal(map['notes/old.md'], undefined);
  assert.equal(map['docs/new.md'], '# Title\nBody');
  assert.equal(map['other.md'], 'keep');

  assert.throws(() => wt.renameFile('docs/new.md', 'other.md'), /already exists/);
  assert.throws(() => wt.renameFile('docs/new.md', '../escape.md'), /Invalid target path/);

  wt.destroy();
});
