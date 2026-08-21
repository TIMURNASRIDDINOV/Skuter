import type { RideReceipt } from '@ozothunder/shared';
import { formatSom } from '@ozothunder/shared';
import { formatDistance, formatDuration } from '../lib';

export function ReceiptScreen({
  receipt,
  onDone,
}: {
  receipt: RideReceipt;
  onDone: () => void;
}) {
  const { breakdown } = receipt;
  return (
    <div className="screen receipt">
      <div className="receipt-hero">✅</div>
      <h1>Поездка завершена</h1>
      <p className="muted">
        {formatDuration(breakdown.durationS)} · {formatDistance(breakdown.distanceM)}
        {receipt.endZoneName !== null ? ` · ${receipt.endZoneName}` : ''}
      </p>

      <div className="receipt-card">
        <div className="line">
          <span>Разблокировка</span>
          <b>{formatSom(breakdown.unlockFee)}</b>
        </div>
        <div className="line">
          <span>
            {breakdown.chargedMinutes} мин × {formatSom(breakdown.ratePerMinute)}
          </span>
          <b>{formatSom(breakdown.timeFee)}</b>
        </div>
        {breakdown.coveredBySubscription && (
          <div className="line">
            <span>Покрыто абонементом</span>
            <b>—</b>
          </div>
        )}
        <div className="line total">
          <span>Итого · {receipt.planName}</span>
          <b>{formatSom(breakdown.total)}</b>
        </div>
      </div>

      <button className="btn primary" onClick={onDone}>
        На карту
      </button>
    </div>
  );
}
