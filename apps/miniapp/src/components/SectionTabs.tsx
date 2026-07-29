export type Section = 'general' | 'rent';

/**
 * Folder-style switcher pinned above the map area: «Общий» is the shared
 * per-minute fleet, «Аренда» is the subscription passes. Replaces the old
 * Аренда slot in the bottom bar — the top edge is where it reads best.
 */
export function SectionTabs({
  section,
  onSection,
}: {
  section: Section;
  onSection: (section: Section) => void;
}) {
  return (
    <div className="section-tabs">
      <button
        className={section === 'general' ? 'section-tab active' : 'section-tab'}
        onClick={() => onSection('general')}
      >
        Общий
      </button>
      <button
        className={section === 'rent' ? 'section-tab active' : 'section-tab'}
        onClick={() => onSection('rent')}
      >
        Аренда
      </button>
    </div>
  );
}
