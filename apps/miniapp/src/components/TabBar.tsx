import { TabIcon } from './icons';

export type Tab = 'map' | 'profile';

/**
 * Uzum-style bottom navigation: two content tabs and a raised circular
 * scan button in its own slot. Hidden while a ride or receipt is on screen —
 * those flows own the whole viewport. Mirrors the native app's tab bar.
 * Аренда lives in the top SectionTabs switcher, not here.
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
        <TabIcon name="map" />
        <span>Карта</span>
      </button>
      <div className="scan-slot">
        <button className="scan-tab" onClick={onScan} aria-label="Сканировать">
          <TabIcon name="scan" size={26} color="#fff" />
        </button>
        <span className="scan-label">Скан</span>
      </div>
      <button
        className={tab === 'profile' ? 'tab active' : 'tab'}
        onClick={() => onTab('profile')}
      >
        <TabIcon name="person" />
        <span>Профиль</span>
      </button>
    </nav>
  );
}
