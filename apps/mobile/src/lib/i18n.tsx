import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type Language = 'ru' | 'uz';

const LANG_KEY = 'scoot.lang';

/**
 * Every user-facing string in the app, RU and UZ. The admin panel is RU-only;
 * the rider app carries the toggle (Profile screen).
 */
const ru = {
  // Auth
  loginTitle: 'Вход в Scoot',
  loginSubtitle: 'Введите номер телефона — отправим код подтверждения',
  phonePlaceholder: '90 123 45 67',
  sendCode: 'Получить код',
  testOnlyPhone: 'В этой сборке вход доступен только тестовому номеру',
  verifyTitle: 'Код из SMS',
  verifySubtitle: 'Отправили 6-значный код на номер',
  wrongCode: 'Неверный код. Попробуйте ещё раз',
  resendCode: 'Отправить код повторно',
  resendIn: 'Повторная отправка через',
  devCodeHint: 'Дев-код подставлен автоматически',
  // Map
  scootersNearby: 'самокатов рядом',
  scooterNearbyOne: 'самокат рядом',
  scan: 'Сканировать',
  battery: 'Заряд',
  range: 'Запас хода',
  pricing: 'Тариф',
  unlockFee: 'Разблокировка',
  perMinute: '/мин',
  unlock: 'Разблокировать',
  subscribe: 'Абонемент',
  refreshed: 'Карта обновлена',
  activeRideBanner: 'Поездка идёт',
  emptyVehicles: 'Рядом нет свободных самокатов',
  emptyVehiclesHint: 'Потяните вниз, чтобы обновить карту',
  distanceAway: 'от центра карты',
  // Statuses
  statusAvailable: 'Свободен',
  statusLowBattery: 'Низкий заряд',
  statusInUse: 'В поездке',
  statusReserved: 'Забронирован',
  statusOffline: 'Не на связи',
  statusMaintenance: 'Обслуживание',
  // Scan
  scanTitle: 'Наведите камеру на QR-код',
  scanHint: 'Код напечатан на руле самоката',
  scanInvalid: 'Это не код Scoot — ищите наклейку вида SCOOT-0042',
  scanConfirmed: 'Код считан',
  simulateScan: 'Симулировать скан (dev)',
  cameraDenied: 'Нет доступа к камере',
  cameraDeniedHint: 'Разрешите доступ к камере, чтобы сканировать QR-код самоката',
  grantCamera: 'Разрешить камеру',
  torch: 'Фонарик',
  // Unlock
  unlockTitle: 'Разблокировка',
  choosePlan: 'Выберите тариф',
  unlocking: 'Соединяемся с самокатом…',
  unlockFailedTitle: 'Не получилось разблокировать',
  retry: 'Повторить',
  cancel: 'Отмена',
  rideAlreadyActive: 'У вас уже есть активная поездка',
  goToRide: 'К поездке',
  vehicleUnavailable: 'Этот самокат сейчас недоступен',
  perMinutePlanName: 'Поминутный',
  subscriptionCovered: 'Покрывается абонементом',
  // Ride
  rideTitle: 'Поездка',
  duration: 'Время',
  distance: 'Расстояние',
  cost: 'Стоимость',
  endRide: 'Завершить поездку',
  ending: 'Завершаем…',
  beep: 'Сигнал',
  beepSent: 'Самокат подал сигнал',
  beepFailed: 'Самокат не ответил',
  inParkingZone: 'В зоне парковки',
  notInParkingZone: 'Вне зоны парковки',
  cantEndHereTitle: 'Здесь нельзя завершить поездку',
  outsideParkingZone: 'Завершить поездку можно только в зоне парковки',
  insideForbiddenZone: 'Здесь парковка запрещена',
  outsideServiceArea: 'Вы за пределами зоны обслуживания',
  nearestParking: 'Ближайшая парковка',
  walkAway: 'пешком',
  showOnMap: 'Показать на карте',
  devStepIntoZone: 'В зону (dev)',
  gotIt: 'Понятно',
  // Receipt
  receiptTitle: 'Поездка завершена',
  total: 'Итого',
  plan: 'Тариф',
  chargedMinutes: 'мин',
  timeFee: 'Поездка',
  parkedAt: 'Парковка',
  coveredBySubscription: 'Покрыто абонементом',
  done: 'Готово',
  receiptStarted: 'Начало',
  receiptEnded: 'Конец',
  // Plans / subscriptions
  plansTitle: 'Абонемент',
  plansSubtitle: 'Самокат закрепляется за вами и исчезает с общей карты',
  choosePlanFor: 'Абонемент на самокат',
  until: 'до',
  buyFor: 'Оплатить',
  purchaseSuccessTitle: 'Абонемент оформлен',
  purchaseSuccessHint: 'Самокат закреплён за вами и скрыт с общей карты',
  paymentFailed: 'Оплата не прошла. Попробуйте ещё раз',
  alreadySubscribed: 'На этот самокат уже оформлен абонемент',
  toMap: 'На карту',
  day: 'день',
  days2_4: 'дня',
  days5: 'дней',
  noPlans: 'Абонементов пока нет',
  pickVehicleFirst: 'Выберите самокат на карте, чтобы оформить абонемент',
  // Profile
  profileTitle: 'Профиль',
  balance: 'Баланс',
  nameLabel: 'Имя',
  namePlaceholder: 'Как к вам обращаться?',
  language: 'Язык',
  mySubscriptions: 'Мои абонементы',
  noSubscriptions: 'Абонементов нет',
  rideHistory: 'История поездок',
  noRides: 'Поездок пока не было',
  logout: 'Выйти',
  save: 'Сохранить',
  active: 'Активна',
  expired: 'Истекла',
  cancelled: 'Отменена',
  // Tabs
  tabMap: 'Карта',
  tabRental: 'Аренда',
  tabScan: 'Скан',
  tabProfile: 'Профиль',
  // Общий / Аренда switcher above the map
  sectionGeneral: 'Общий',
  sectionRent: 'Аренда',
  // Rental tab
  rentalTitle: 'Аренда',
  subscriptionUntil: 'До',
  rentalDailyHint: 'Безлимит на сутки для одного самоката',
  rentalWeeklyHint: 'Безлимит на',
  rentalDays: 'дней для одного самоката',
  rentalScanCta: 'Отсканировать самокат и купить',
  // Telegram login
  orSeparator: 'или',
  continueWithTelegram: 'Продолжить с Telegram',
  telegramWaiting: 'Подтвердите вход в Telegram и вернитесь в приложение…',
  telegramFailed: 'Не удалось войти через Telegram',
  telegramCancel: 'Отмена',
  // Manual code entry
  enterCodeManually: 'Ввести код вручную',
  manualCodeTitle: 'Введите код самоката',
  manualCodeHint: 'Четыре цифры под QR-кодом, например SCOOT-0042',
  manualCodeSubmit: 'Найти самокат',
  scanTrouble: 'Не сканируется? Введите код вручную',
  // Shared states
  loadingError: 'Не удалось загрузить данные',
  tryAgain: 'Повторить',
  offlineHint: 'Проверьте подключение к интернету',
};

export type Strings = typeof ru;

const uz: Strings = {
  loginTitle: 'Scoot’ga kirish',
  loginSubtitle: 'Telefon raqamingizni kiriting — tasdiqlash kodini yuboramiz',
  phonePlaceholder: '90 123 45 67',
  sendCode: 'Kod olish',
  testOnlyPhone: 'Bu build’da faqat test raqami bilan kirish mumkin',
  verifyTitle: 'SMS’dagi kod',
  verifySubtitle: '6 xonali kod yuborildi:',
  wrongCode: 'Kod noto‘g‘ri. Qayta urinib ko‘ring',
  resendCode: 'Kodni qayta yuborish',
  resendIn: 'Qayta yuborish:',
  devCodeHint: 'Dev-kod avtomatik qo‘yildi',
  scootersNearby: 'ta samokat yaqin-atrofda',
  scooterNearbyOne: 'ta samokat yaqin-atrofda',
  scan: 'Skanerlash',
  battery: 'Quvvat',
  range: 'Masofa zaxirasi',
  pricing: 'Tarif',
  unlockFee: 'Qulfdan chiqarish',
  perMinute: '/daq',
  unlock: 'Qulfdan chiqarish',
  subscribe: 'Abonement',
  refreshed: 'Xarita yangilandi',
  activeRideBanner: 'Safar davom etmoqda',
  emptyVehicles: 'Yaqin-atrofda bo‘sh samokat yo‘q',
  emptyVehiclesHint: 'Xaritani yangilash uchun pastga torting',
  distanceAway: 'xarita markazidan',
  statusAvailable: 'Bo‘sh',
  statusLowBattery: 'Quvvat kam',
  statusInUse: 'Safarda',
  statusReserved: 'Band qilingan',
  statusOffline: 'Aloqada emas',
  statusMaintenance: 'Ta’mirda',
  scanTitle: 'Kamerani QR-kodga qarating',
  scanHint: 'Kod samokat rulida joylashgan',
  scanInvalid: 'Bu Scoot kodi emas — SCOOT-0042 ko‘rinishidagi yorliqni qidiring',
  scanConfirmed: 'Kod o‘qildi',
  simulateScan: 'Skanni simulyatsiya qilish (dev)',
  cameraDenied: 'Kameraga ruxsat yo‘q',
  cameraDeniedHint: 'Samokat QR-kodini skanerlash uchun kameraga ruxsat bering',
  grantCamera: 'Kameraga ruxsat berish',
  torch: 'Fonar',
  unlockTitle: 'Qulfdan chiqarish',
  choosePlan: 'Tarifni tanlang',
  unlocking: 'Samokat bilan bog‘lanmoqdamiz…',
  unlockFailedTitle: 'Qulfdan chiqarib bo‘lmadi',
  retry: 'Qayta urinish',
  cancel: 'Bekor qilish',
  rideAlreadyActive: 'Sizda faol safar bor',
  goToRide: 'Safarga o‘tish',
  vehicleUnavailable: 'Bu samokat hozir band',
  perMinutePlanName: 'Daqiqasiga',
  subscriptionCovered: 'Abonement hisobidan',
  rideTitle: 'Safar',
  duration: 'Vaqt',
  distance: 'Masofa',
  cost: 'Narx',
  endRide: 'Safarni yakunlash',
  ending: 'Yakunlanmoqda…',
  beep: 'Signal',
  beepSent: 'Samokat signal berdi',
  beepFailed: 'Samokat javob bermadi',
  inParkingZone: 'To‘xtash zonasida',
  notInParkingZone: 'To‘xtash zonasidan tashqarida',
  cantEndHereTitle: 'Bu yerda safarni yakunlab bo‘lmaydi',
  outsideParkingZone: 'Safarni faqat to‘xtash zonasida yakunlash mumkin',
  insideForbiddenZone: 'Bu yerda to‘xtash taqiqlangan',
  outsideServiceArea: 'Siz xizmat hududidan tashqaridasiz',
  nearestParking: 'Eng yaqin to‘xtash joyi',
  walkAway: 'piyoda',
  showOnMap: 'Xaritada ko‘rsatish',
  devStepIntoZone: 'Zonaga (dev)',
  gotIt: 'Tushunarli',
  receiptTitle: 'Safar yakunlandi',
  total: 'Jami',
  plan: 'Tarif',
  chargedMinutes: 'daq',
  timeFee: 'Safar',
  parkedAt: 'To‘xtash joyi',
  coveredBySubscription: 'Abonement hisobidan qoplandi',
  done: 'Tayyor',
  receiptStarted: 'Boshlanish',
  receiptEnded: 'Tugash',
  plansTitle: 'Abonement',
  plansSubtitle: 'Samokat sizga biriktiriladi va umumiy xaritadan yashiriladi',
  choosePlanFor: 'Samokat uchun abonement',
  until: 'gacha',
  buyFor: 'To‘lash',
  purchaseSuccessTitle: 'Abonement rasmiylashtirildi',
  purchaseSuccessHint: 'Samokat sizga biriktirildi va umumiy xaritadan yashirildi',
  paymentFailed: 'To‘lov amalga oshmadi. Qayta urinib ko‘ring',
  alreadySubscribed: 'Bu samokatga allaqachon abonement rasmiylashtirilgan',
  toMap: 'Xaritaga',
  day: 'kun',
  days2_4: 'kun',
  days5: 'kun',
  noPlans: 'Hozircha abonementlar yo‘q',
  pickVehicleFirst: 'Abonement uchun xaritada samokat tanlang',
  profileTitle: 'Profil',
  balance: 'Balans',
  nameLabel: 'Ism',
  namePlaceholder: 'Sizga qanday murojaat qilaylik?',
  language: 'Til',
  mySubscriptions: 'Mening abonementlarim',
  noSubscriptions: 'Abonementlar yo‘q',
  rideHistory: 'Safarlar tarixi',
  noRides: 'Hozircha safarlar bo‘lmagan',
  logout: 'Chiqish',
  save: 'Saqlash',
  active: 'Faol',
  expired: 'Muddati o‘tgan',
  cancelled: 'Bekor qilingan',
  // Tabs
  tabMap: 'Xarita',
  tabRental: 'Ijara',
  tabScan: 'Skan',
  tabProfile: 'Profil',
  // Общий / Аренда switcher above the map
  sectionGeneral: 'Umumiy',
  sectionRent: 'Ijara',
  // Rental tab
  rentalTitle: 'Ijara',
  subscriptionUntil: 'Muddati:',
  rentalDailyHint: 'Bitta samokat uchun bir kunlik cheksiz tarif',
  rentalWeeklyHint: 'Bitta samokat uchun',
  rentalDays: 'kunlik cheksiz tarif',
  rentalScanCta: 'Samokatni skanerlab sotib olish',
  // Telegram login
  orSeparator: 'yoki',
  continueWithTelegram: 'Telegram orqali davom etish',
  telegramWaiting: 'Telegramda kirishni tasdiqlang va ilovaga qaytib keling…',
  telegramFailed: 'Telegram orqali kirib bo‘lmadi',
  telegramCancel: 'Bekor qilish',
  // Manual code entry
  enterCodeManually: 'Kodni qo‘lda kiritish',
  manualCodeTitle: 'Samokat kodini kiriting',
  manualCodeHint: 'QR-kod ostidagi to‘rt raqam, masalan SCOOT-0042',
  manualCodeSubmit: 'Samokatni topish',
  scanTrouble: 'Skanerlanmayaptimi? Kodni qo‘lda kiriting',
  loadingError: 'Ma’lumotlarni yuklab bo‘lmadi',
  tryAgain: 'Qayta urinish',
  offlineHint: 'Internet aloqasini tekshiring',
};

const STRINGS: Record<Language, Strings> = { ru, uz };

interface LanguageContextValue {
  lang: Language;
  t: Strings;
  setLang: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>('ru');

  useEffect(() => {
    void SecureStore.getItemAsync(LANG_KEY).then((stored) => {
      if (stored === 'ru' || stored === 'uz') setLangState(stored);
    });
  }, []);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    void SecureStore.setItemAsync(LANG_KEY, next);
  }, []);

  return (
    <LanguageContext.Provider value={{ lang, t: STRINGS[lang], setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (ctx === null) throw new Error('useI18n must be used inside LanguageProvider');
  return ctx;
}
