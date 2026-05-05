import type {
  Condition,
  DrinkRecord,
  DrinkingFrequency,
  DrinkingMode,
  FlushLevel,
  Gender,
  Profile,
} from './types';

export const DRINKING_MODES: DrinkingMode[] = ['じわ酔い', '会食モード', '二次会温存', '明日守る'];

export const GENDERS: Gender[] = ['男性', '女性', 'その他/回答しない'];

export const DRINKING_FREQUENCIES: DrinkingFrequency[] = [
  'ほぼ飲まない',
  '月1〜3回',
  '週1〜2回',
  '週3〜4回',
  'ほぼ毎日',
];

export const FLUSH_LEVELS: FlushLevel[] = ['赤くなりやすい', '少し赤くなる', '赤くなりにくい'];

export const CONDITIONS: Condition[] = ['良い', '普通', '疲れ気味', '寝不足・空腹'];

export const DRINK_KIND_SUGGESTIONS = [
  'ビール',
  'ハイボール',
  'ワイン',
  '日本酒',
  '焼酎',
  'カクテル',
  'その他',
];

export const DRINK_PRESETS: Record<
  string,
  {
    volumeMl: number;
    abvPercent: number;
    sips: number;
  }
> = {
  ビール: {
    volumeMl: 350,
    abvPercent: 5,
    sips: 8,
  },
  ハイボール: {
    volumeMl: 350,
    abvPercent: 7,
    sips: 8,
  },
  ワイン: {
    volumeMl: 150,
    abvPercent: 12,
    sips: 6,
  },
  日本酒: {
    volumeMl: 180,
    abvPercent: 15,
    sips: 6,
  },
  焼酎: {
    volumeMl: 120,
    abvPercent: 25,
    sips: 6,
  },
  カクテル: {
    volumeMl: 180,
    abvPercent: 8,
    sips: 6,
  },
  その他: {
    volumeMl: 250,
    abvPercent: 5,
    sips: 6,
  },
};

export const MODE_SETTINGS: Record<
  DrinkingMode,
  {
    minutesPer10g: number;
    waterEveryMinutes: number;
    waterEveryGrams: number;
    note: string;
  }
> = {
  じわ酔い: {
    minutesPer10g: 30,
    waterEveryMinutes: 35,
    waterEveryGrams: 12,
    note: 'ゆっくり味わう標準ペース',
  },
  会食モード: {
    minutesPer10g: 24,
    waterEveryMinutes: 40,
    waterEveryGrams: 15,
    note: '会話に合わせつつ急がない',
  },
  二次会温存: {
    minutesPer10g: 34,
    waterEveryMinutes: 35,
    waterEveryGrams: 12,
    note: '後半に余力を残す',
  },
  明日守る: {
    minutesPer10g: 42,
    waterEveryMinutes: 30,
    waterEveryGrams: 10,
    note: 'かなり控えめに進める',
  },
};

export function calculatePureAlcoholGrams(volumeMl: number, abvPercent: number) {
  return roundToOne(volumeMl * (abvPercent / 100) * 0.8);
}

export function planDrink(
  input: {
    kind: string;
    volumeMl: number;
    abvPercent: number;
    sips: number;
  },
  mode: DrinkingMode,
  profile: Profile,
): DrinkRecord {
  const pureAlcoholGrams = calculatePureAlcoholGrams(input.volumeMl, input.abvPercent);
  const riskFactor = calculatePaceFactor(profile);
  const modeSetting = MODE_SETTINGS[mode];
  const recommendedMinutes = clamp(
    Math.ceil((pureAlcoholGrams / 10) * modeSetting.minutesPer10g * riskFactor),
    18,
    180,
  );
  const sipIntervalMinutes = roundToOne(recommendedMinutes / Math.max(input.sips, 1));
  const waterReminderCount = calculateWaterReminderCount(
    pureAlcoholGrams,
    recommendedMinutes,
    mode,
  );

  return {
    id: `drink-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind.trim(),
    volumeMl: input.volumeMl,
    abvPercent: input.abvPercent,
    sips: input.sips,
    pureAlcoholGrams,
    recommendedMinutes,
    sipIntervalMinutes,
    waterReminderCount,
    addedAt: new Date().toISOString(),
    mode,
  };
}

export function calculatePaceFactor(profile: Profile) {
  let factor = 1;
  const bmi = profile.weightKg / Math.pow(profile.heightCm / 100, 2);

  if (profile.weightKg < 50) factor += 0.2;
  else if (profile.weightKg < 60) factor += 0.1;

  if (bmi < 18.5) factor += 0.1;
  if (profile.gender === '女性') factor += 0.1;
  if (profile.frequency === 'ほぼ飲まない') factor += 0.15;
  if (profile.frequency === '月1〜3回') factor += 0.08;
  if (profile.flush === '赤くなりやすい') factor += 0.25;
  if (profile.flush === '少し赤くなる') factor += 0.12;
  if (profile.condition === '疲れ気味') factor += 0.12;
  if (profile.condition === '寝不足・空腹') factor += 0.25;

  return clamp(factor, 1, 1.8);
}

export function calculateWaterReminderCount(
  pureAlcoholGrams: number,
  recommendedMinutes: number,
  mode: DrinkingMode,
) {
  const modeSetting = MODE_SETTINGS[mode];
  const byTime = Math.floor(recommendedMinutes / modeSetting.waterEveryMinutes);
  const byAlcohol = Math.floor(pureAlcoholGrams / modeSetting.waterEveryGrams);
  const minimum = pureAlcoholGrams >= 8 || recommendedMinutes >= 25 ? 1 : 0;

  return clamp(Math.max(byTime, byAlcohol, minimum), 0, 6);
}

export function getSipAdherenceRate(sipDoneCount: number, sipOnPaceCount: number) {
  if (sipDoneCount === 0) return 0;
  return Math.round((sipOnPaceCount / sipDoneCount) * 100);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function roundToOne(value: number) {
  return Math.round(value * 10) / 10;
}
