import type { UserProfile } from '@ozothunder/shared';
import { formatSom } from '@ozothunder/shared';

export function ProfileScreen({
  user,
  onLogout,
}: {
  user: UserProfile | null;
  onLogout: () => void;
}) {
  return (
    <div className="screen profile-screen">
      <h1>Профиль</h1>

      <div className="receipt-card">
        <div className="line">
          <span className="muted">Имя</span>
          <b>{user?.name ?? 'Без имени'}</b>
        </div>
        <div className="line">
          <span className="muted">Аккаунт</span>
          <b>{user === null ? '…' : user.phone ?? 'Telegram'}</b>
        </div>
        <div className="line total">
          <span>Баланс</span>
          <b className="highlight">{user === null ? '…' : formatSom(user.balance)}</b>
        </div>
      </div>

      <button className="btn ghost" onClick={onLogout}>
        Выйти
      </button>
    </div>
  );
}
