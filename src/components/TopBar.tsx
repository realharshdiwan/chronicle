import { BranchSwitcher } from './topbar/BranchSwitcher';
import { CommitModalOrPopover } from './topbar/CommitModalOrPopover';
import { TopBarActions } from './topbar/TopBarActions';

interface TopBarProps {
  onToggleMobileSidebar: () => void;
}

export function TopBar({ onToggleMobileSidebar }: TopBarProps) {
  return (
    <header className="h-14 border-b border-indigo-300/[0.18] glass-topbar px-3 lg:px-4 flex items-center justify-between gap-2.5 shrink-0 relative z-20 overflow-hidden">
      <BranchSwitcher onToggleMobileSidebar={onToggleMobileSidebar} />
      <CommitModalOrPopover />
      <TopBarActions />
    </header>
  );
}
