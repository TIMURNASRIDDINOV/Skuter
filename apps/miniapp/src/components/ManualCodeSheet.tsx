import { useEffect, useRef, useState } from 'react';

/**
 * Slide-up fallback when the camera cannot capture the QR (or outside
 * Telegram, where there is no native scanner): the rider types the nine
 * digits printed under the code.
 */
export function ManualCodeSheet({
  open,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  /** Server/lookup error to show under the field, e.g. "not found". */
  error: string | null;
  onSubmit: (qrCode: string) => void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDigits('');
      // Focus after the slide-in transition so the keyboard doesn't jump.
      const timer = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  const valid = /^\d{9}$/.test(digits);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="manual-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h2>Введите код самоката</h2>
        <p className="muted">Девять цифр под QR-кодом на руле</p>
        <div className="code-row">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            maxLength={9}
            value={digits}
            placeholder="000000042"
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) onSubmit(digits);
            }}
          />
        </div>
        {error !== null && <div className="error-box">{error}</div>}
        <button className="btn primary" disabled={!valid} onClick={() => onSubmit(digits)}>
          Найти самокат
        </button>
        <button className="btn ghost" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}
