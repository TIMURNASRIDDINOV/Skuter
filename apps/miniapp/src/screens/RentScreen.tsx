import type { Plan, SubscriptionDetail } from '@scoot/shared';
import { formatSom } from '@scoot/shared';

/**
 * Аренда tab: active passes first, then the daily/weekly plans. A pass is
 * bound to one scooter, so buying starts with scanning it — the shared scan
 * flow returns here with the vehicle resolved.
 */
export function RentScreen({
  plans,
  subscriptions,
  loading,
  buying,
  notice,
  onBuy,
}: {
  plans: Plan[];
  subscriptions: SubscriptionDetail[];
  loading: boolean;
  buying: boolean;
  notice: string | null;
  onBuy: (plan: Plan) => void;
}) {
  const rentalPlans = plans.filter((plan) => plan.kind !== 'per_minute');
  const active = subscriptions.filter((sub) => sub.status === 'active');

  return (
    <div className="screen rent-screen">
      <section>
        <h2 className="section-title">Мои абонементы</h2>
        {loading ? (
          <div className="placeholder-card">Загрузка…</div>
        ) : active.length === 0 ? (
          <div className="placeholder-card">
            Пока нет активных абонементов. Абонемент выгоднее поминутного тарифа, если
            катаетесь каждый день.
          </div>
        ) : (
          active.map((sub) => (
            <div key={sub.id} className="sub-card">
              <div className="sub-head">
                <b>{sub.plan.name}</b>
                <span className="pill pill-ok">Активен</span>
              </div>
              <div className="muted">
                Самокат {sub.vehicle.qrCode} · {sub.vehicle.model}
              </div>
              <div className="muted">
                До {new Date(sub.expiresAt).toLocaleString('ru-RU', {
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Tashkent',
                })}
              </div>
            </div>
          ))
        )}
      </section>

      {notice !== null && <div className="tariff">{notice}</div>}

      <section>
        <h2 className="section-title">Тарифы</h2>
        {rentalPlans.map((plan) => (
          <div key={plan.id} className="plan-card">
            <div className="sub-head">
              <b>{plan.name}</b>
              <b className="highlight">{formatSom(plan.price)}</b>
            </div>
            <div className="muted">
              {plan.durationDays === 1
                ? 'Безлимит на сутки для одного самоката'
                : `Безлимит на ${String(plan.durationDays)} дней для одного самоката`}
            </div>
            <button className="btn primary small" disabled={buying} onClick={() => onBuy(plan)}>
              ▣ Отсканировать самокат и купить
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
