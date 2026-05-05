export type Gender = '男性' | '女性' | 'その他/回答しない';

export type DrinkingFrequency =
  | 'ほぼ飲まない'
  | '月1〜3回'
  | '週1〜2回'
  | '週3〜4回'
  | 'ほぼ毎日';

export type FlushLevel = '赤くなりやすい' | '少し赤くなる' | '赤くなりにくい';

export type Condition = '良い' | '普通' | '疲れ気味' | '寝不足・空腹';

export type DrinkingMode = 'じわ酔い' | '会食モード' | '二次会温存' | '明日守る';

export type SessionStatus = 'active' | 'paused';

export type NotificationKind = 'sip' | 'water';

export type Profile = {
  age: number;
  gender: Gender;
  heightCm: number;
  weightKg: number;
  frequency: DrinkingFrequency;
  flush: FlushLevel;
  condition: Condition;
  createdAt: string;
  updatedAt: string;
};

export type DrinkDraft = {
  kind: string;
  volumeMl: string;
  abvPercent: string;
  sips: string;
};

export type DrinkRecord = {
  id: string;
  kind: string;
  volumeMl: number;
  abvPercent: number;
  sips: number;
  pureAlcoholGrams: number;
  recommendedMinutes: number;
  sipIntervalMinutes: number;
  waterReminderCount: number;
  addedAt: string;
  mode: DrinkingMode;
};

export type DrinkingSession = {
  id: string;
  status: SessionStatus;
  mode: DrinkingMode;
  startedAt: string;
  endedAt?: string;
  pauseStartedAt?: string;
  pausedTotalMs: number;
  drinks: DrinkRecord[];
  totalPureAlcoholGrams: number;
  sipReminderCount: number;
  sipDoneCount: number;
  sipOnPaceCount: number;
  fastSipCount: number;
  waterReminderCount: number;
  waterDoneCount: number;
  notificationIds: string[];
  autoSipIndex?: number;
  nextSipStartedAt?: string;
  nextSipDueAt?: string;
  warning?: string;
};

export type HistoryDrink = Omit<DrinkRecord, 'id'> & {
  id: string;
};

export type HistoryEntry = {
  id: string;
  dateKey: string;
  mode: DrinkingMode;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  totalPureAlcoholGrams: number;
  sipReminderCount: number;
  sipDoneCount: number;
  sipAdherenceRate: number;
  fastSipCount: number;
  waterReminderCount: number;
  waterDoneCount: number;
  drinks: HistoryDrink[];
  nextDayMemo: string;
};
