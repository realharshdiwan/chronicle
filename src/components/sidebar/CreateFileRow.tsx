import { useState, type FormEvent } from 'react';
import { useWorkspaceStore } from '../../state/workspace';

interface CreateFileRowProps {
  onClose: () => void;
}

export function CreateFileRow({ onClose }: CreateFileRowProps) {
  const { createFile } = useWorkspaceStore();
  const [newFilePath, setNewFilePath] = useState('');

  const handleCreateFile = (e: FormEvent) => {
    e.preventDefault();
    if (!newFilePath.trim()) return;
    createFile(newFilePath, `# ${newFilePath.trim()}\n\n`);
    setNewFilePath('');
    onClose();
  };

  return (
    <form
      onSubmit={handleCreateFile}
      className="px-3 py-2.5 border-b border-indigo-300/[0.12] bg-indigo-500/[0.06] flex flex-col gap-2"
    >
      <label htmlFor="new-file-input" className="sr-only">
        New file path
      </label>
      <input
        id="new-file-input"
        type="text"
        value={newFilePath}
        onChange={(e) => setNewFilePath(e.target.value)}
        placeholder="notes/idea.md"
        autoFocus
        className="w-full bg-indigo-950/60 border border-indigo-300/25 rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder:text-indigo-200/50 focus:outline-none focus:border-cyan-300"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-1 text-xs text-indigo-200 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-2.5 py-1 text-xs font-semibold bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 rounded hover:from-cyan-300 hover:to-violet-300"
        >
          Add File
        </button>
      </div>
    </form>
  );
}
