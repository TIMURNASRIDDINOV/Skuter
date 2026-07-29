export type Tab = 'map' | 'rent' | 'profile';

/**
 * Uzum-style bottom navigation: three content tabs and a raised circular
 * scan button in the middle. Hidden while a ride or receipt is on screen —
 * those flows own the whole viewport.
 */
export function TabBar({
  tab,
  onTab,
  onScan,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  onScan: () => void;
}) {
  return (
    <nav className="tabbar">
      <button className={tab === 'map' ? 'tab active' : 'tab'} onClick={() => onTab('map')}>
        <span className="tab-icon">🗺</span>
        <span>Карта</span>
      </button>
      <button className={tab === 'rent' ? 'tab active' : 'tab'} onClick={() => onTab('rent')}>
        <span className="tab-icon">🎟</span>
        <span>Аренда</span>
      </button>
      <button className="scan-tab" onClick={onScan} aria-label="Сканировать">
        <span>▣</span>
      </button>
      <button
        className={tab === 'profile' ? 'tab active' : 'tab'}
        onClick={() => onTab('profile')}
      >
        <span className="tab-icon">👤</span>
        <span>Профиль</span>
      </button>
    </nav>
  );
}
