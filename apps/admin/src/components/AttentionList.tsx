import { Select, Typography, theme } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import { Link } from 'react-router';
import type { AnomalyThresholds, AttentionRow } from '../lib/anomalies.js';
import { SEVERITY_META } from './status.js';

/**
 * The queue of things wrong right now, ranked most urgent first.
 *
 * This is the dashboard's first answer, ahead of any total. A list rather than
 * a grid of counters: an operator needs to know *which* scooter is stranded —
 * something the reference panel's wall of 28 alarm counters never says.
 */
export function AttentionList({
  rows,
  thresholds,
  onThresholdsChange,
  maxRows = 9,
}: {
  rows: readonly AttentionRow[];
  thresholds: AnomalyThresholds;
  onThresholdsChange: (next: AnomalyThresholds) => void;
  maxRows?: number;
}): React.ReactElement {
  const { token } = theme.useToken();
  const shown = rows.slice(0, maxRows);
  const overflow = rows.length - shown.length;

  if (rows.length === 0) {
    return (
      <div style={{ padding: '28px 0', textAlign: 'center' }}>
        <CheckCircleFilled style={{ fontSize: 24, color: SEVERITY_META.ok.colour }} />
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">
            Всё в порядке — ничего не требует вмешательства
          </Typography.Text>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {shown.map((row) => (
          <Link
            key={row.id}
            to={row.href}
            className="fleet-enter"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 4px',
              color: 'inherit',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <span
              aria-label={SEVERITY_META[row.severity].label}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flex: '0 0 auto',
                background: SEVERITY_META[row.severity].colour,
              }}
            />
            {row.subject === null ? (
              <Typography.Text ellipsis>{row.detail}</Typography.Text>
            ) : (
              <>
                <Typography.Text strong style={{ fontFamily: 'monospace', flex: '0 0 auto' }}>
                  {row.subject}
                </Typography.Text>
                <Typography.Text type="secondary" ellipsis style={{ flex: 1, minWidth: 0 }}>
                  {row.detail}
                </Typography.Text>
              </>
            )}
          </Link>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 10,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {overflow > 0 ? `и ещё ${String(overflow)}` : ''}
        </Typography.Text>

        {/* The threshold sits at the point of use rather than in a settings
            screen — the one interaction pattern worth taking wholesale from
            the reference panel. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Долгая поездка от
          </Typography.Text>
          <Select
            size="small"
            value={thresholds.overlongRideMinutes}
            style={{ width: 88 }}
            onChange={(minutes) => {
              onThresholdsChange({ ...thresholds, overlongRideMinutes: minutes });
            }}
            options={[30, 60, 90, 120, 180].map((minutes) => ({
              value: minutes,
              label: `${String(minutes)} мин`,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
