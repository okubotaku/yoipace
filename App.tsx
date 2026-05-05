import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  CONDITIONS,
  DRINK_KIND_SUGGESTIONS,
  DRINKING_FREQUENCIES,
  DRINKING_MODES,
  FLUSH_LEVELS,
  GENDERS,
  MODE_SETTINGS,
  getSipAdherenceRate,
  planDrink,
} from './src/calculations';
import type {
  Condition,
  DrinkDraft,
  DrinkRecord,
  DrinkingFrequency,
  DrinkingMode,
  DrinkingSession,
  FlushLevel,
  Gender,
  HistoryEntry,
  NotificationKind,
  Profile,
} from './src/types';

const PROFILE_KEY = 'yoipace.profile.v1';
const SESSION_KEY = 'yoipace.activeSession.v1';
const HISTORY_KEY = 'yoipace.history.v1';
const SIP_CHANNEL_ID = 'yoipace-sip';
const WATER_CHANNEL_ID = 'yoipace-water';

const emptyDrinkDraft: DrinkDraft = {
  kind: 'ビール',
  volumeMl: '350',
  abvPercent: '5',
  sips: '8',
};

const emptyProfileDraft = {
  age: '',
  gender: '男性' as Gender,
  heightCm: '',
  weightKg: '',
  frequency: '週1〜2回' as DrinkingFrequency,
  flush: '少し赤くなる' as FlushLevel,
  condition: '普通' as Condition,
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileDraft, setProfileDraft] = useState(emptyProfileDraft);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [selectedMode, setSelectedMode] = useState<DrinkingMode>('じわ酔い');
  const [drinkDraft, setDrinkDraft] = useState<DrinkDraft>(emptyDrinkDraft);
  const [session, setSession] = useState<DrinkingSession | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [notificationStatus, setNotificationStatus] = useState('未確認');
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const load = async () => {
      const [storedProfile, storedSession, storedHistory] = await Promise.all([
        AsyncStorage.getItem(PROFILE_KEY),
        AsyncStorage.getItem(SESSION_KEY),
        AsyncStorage.getItem(HISTORY_KEY),
      ]);

      if (storedProfile) {
        const parsedProfile = JSON.parse(storedProfile) as Profile;
        setProfile(parsedProfile);
        setProfileDraft(profileToDraft(parsedProfile));
      } else {
        setIsEditingProfile(true);
      }

      if (storedSession) {
        setSession(JSON.parse(storedSession) as DrinkingSession);
      }

      if (storedHistory) {
        setHistory(JSON.parse(storedHistory) as HistoryEntry[]);
      }

      setHydrated(true);
    };

    load().catch(() => {
      Alert.alert('読み込みに失敗しました', '保存データを読み込めませんでした。');
      setHydrated(true);
      setIsEditingProfile(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (profile) {
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } else {
      AsyncStorage.removeItem(PROFILE_KEY);
    }
  }, [hydrated, profile]);

  useEffect(() => {
    if (!hydrated) return;
    if (session) {
      AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      AsyncStorage.removeItem(SESSION_KEY);
    }
  }, [hydrated, session]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [hydrated, history]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const kind = notification.request.content.data?.kind as NotificationKind | undefined;
      if (kind === 'sip') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }
      if (kind === 'water') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!session || session.status !== 'active' || !session.nextSipDueAt) return;

    const dueMs = new Date(session.nextSipDueAt).getTime();
    if (dueMs > nowMs) return;

    setSession((current) => {
      if (!current || current.status !== 'active' || !current.nextSipDueAt) return current;

      const currentDueMs = new Date(current.nextSipDueAt).getTime();
      if (currentDueMs > Date.now()) return current;

      return advanceAutoSipCountdown(current, Date.now());
    });
  }, [nowMs, session]);

  const plannedDrink = useMemo(() => {
    if (!profile) return null;
    const parsed = parseDrinkDraft(drinkDraft);
    if (!parsed) return null;
    return planDrink(parsed, selectedMode, profile);
  }, [drinkDraft, profile, selectedMode]);

  const currentDrink = session ? getAutoCurrentDrink(session) ?? getCurrentDrink(session) : null;
  const sipTimer = session ? getSipTimerState(session, currentDrink, nowMs) : null;
  const activeDurationMinutes = session ? getSessionDurationMinutes(session, nowMs) : 0;
  const adherenceRate = session
    ? getSipAdherenceRate(session.sipDoneCount, session.sipOnPaceCount)
    : 0;
  const paceCaution =
    session && session.totalPureAlcoholGrams >= 40
      ? session.totalPureAlcoholGrams >= 60
        ? '今日はかなり多めです。ここからは追加せず、水と休憩を優先してください。'
        : '今日は多めのゾーンに入っています。次の一杯より、水と間隔を優先しましょう。'
      : undefined;

  const saveProfile = () => {
    const nextProfile = parseProfileDraft(profileDraft, profile);
    if (!nextProfile) return;
    if (nextProfile.age < 20) {
      Alert.alert(
        '保存できません',
        'このMVPは20歳以上の飲酒ペース管理向けです。法定飲酒年齢未満の飲酒はできません。',
      );
      return;
    }

    setProfile(nextProfile);
    setIsEditingProfile(false);
    Haptics.selectionAsync().catch(() => undefined);
  };

  const ensureNotificationAccess = async () => {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(SIP_CHANNEL_ID, {
        name: 'Yoipace 一口通知',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 180],
      });
      await Notifications.setNotificationChannelAsync(WATER_CHANNEL_ID, {
        name: 'Yoipace 水分補給通知',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 120, 120, 360],
      });
    }

    const current = await Notifications.getPermissionsAsync();
    const finalStatus =
      current.status === 'granted' ? current.status : (await Notifications.requestPermissionsAsync()).status;

    setNotificationStatus(finalStatus === 'granted' ? '許可済み' : '未許可');
    return finalStatus === 'granted';
  };

  const scheduleDrinkNotifications = async (drink: DrinkRecord, startDelaySeconds = 0) => {
    const granted = await ensureNotificationAccess();
    if (!granted) return [] as string[];

    const ids: string[] = [];
    for (let i = 1; i <= drink.sips; i += 1) {
      const id = await scheduleLocalNotification(
        '次の一口のタイミング',
        `${drink.kind}は急がず一口だけ。飲み切り目安は約${drink.recommendedMinutes}分です。`,
        startDelaySeconds + drink.sipIntervalMinutes * 60 * i,
        'sip',
      );
      ids.push(id);
    }

    for (let i = 1; i <= drink.waterReminderCount; i += 1) {
      const spacing = drink.recommendedMinutes / (drink.waterReminderCount + 1);
      const id = await scheduleLocalNotification(
        '水を挟むタイミング',
        'ここで水を一口。ペースを落として、飲みすぎを防ぎましょう。',
        startDelaySeconds + Math.max(60, spacing * 60 * i),
        'water',
      );
      ids.push(id);
    }

    return ids;
  };

  const startSession = async () => {
    if (!profile || !plannedDrink) {
      Alert.alert('入力を確認してください', 'プロフィールとお酒の内容を登録してください。');
      return;
    }

    const sessionDrink = createSessionDrink(plannedDrink);
    const notificationIds = await scheduleDrinkNotifications(sessionDrink);
    const startedAt = new Date().toISOString();
    setSession({
      id: `session-${Date.now()}`,
      status: 'active',
      mode: selectedMode,
      startedAt,
      pausedTotalMs: 0,
      drinks: [sessionDrink],
      totalPureAlcoholGrams: sessionDrink.pureAlcoholGrams,
      sipReminderCount: sessionDrink.sips,
      sipDoneCount: 0,
      sipOnPaceCount: 0,
      fastSipCount: 0,
      waterReminderCount: sessionDrink.waterReminderCount,
      waterDoneCount: 0,
      notificationIds,
      autoSipIndex: 0,
      nextSipStartedAt: startedAt,
      nextSipDueAt: addMinutes(Date.now(), sessionDrink.sipIntervalMinutes).toISOString(),
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  };

  const addDrink = async () => {
    if (!session) {
      await startSession();
      return;
    }
    if (!profile || !plannedDrink) {
      Alert.alert('入力を確認してください', '追加するお酒の内容を入力してください。');
      return;
    }
    if (session.status === 'paused') {
      Alert.alert('一時停止中です', '再開してから一杯追加してください。');
      return;
    }

    const sessionDrink = createSessionDrink(plannedDrink);
    const scheduleDelaySeconds = getRemainingAutoSipQueueSeconds(session, Date.now());
    const notificationIds = await scheduleDrinkNotifications(sessionDrink, scheduleDelaySeconds);
    const autoSipIndex = getAutoSipIndex(session);
    const wasAllSipsDone = autoSipIndex >= session.sipReminderCount || !session.nextSipDueAt;
    setSession({
      ...session,
      drinks: [...session.drinks, sessionDrink],
      totalPureAlcoholGrams: roundSessionGrams(session.totalPureAlcoholGrams + sessionDrink.pureAlcoholGrams),
      sipReminderCount: session.sipReminderCount + sessionDrink.sips,
      waterReminderCount: session.waterReminderCount + sessionDrink.waterReminderCount,
      notificationIds: [...session.notificationIds, ...notificationIds],
      autoSipIndex,
      nextSipStartedAt: wasAllSipsDone ? new Date().toISOString() : session.nextSipStartedAt,
      nextSipDueAt: wasAllSipsDone
        ? addMinutes(Date.now(), sessionDrink.sipIntervalMinutes).toISOString()
        : session.nextSipDueAt,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  };

  const markSipDone = () => {
    if (!session || session.status !== 'active') return;
    if (session.sipDoneCount >= session.sipReminderCount) {
      Alert.alert('一杯のペース完了', '次の一杯を追加するか、飲酒を終了してください。');
      return;
    }

    const now = Date.now();
    const dueAt = session.nextSipDueAt ? new Date(session.nextSipDueAt).getTime() : now;
    const wasDueInGrace = wasRecentlyDue(session, now);
    const tooFast = now < dueAt - 60000 && !wasDueInGrace;
    const onPace = !tooFast;
    const nextSipDoneCount = session.sipDoneCount + 1;
    const warning = tooFast
      ? 'ペースが早いです。次の一口は通知まで待って、水を挟みましょう。'
      : undefined;

    setSession({
      ...session,
      sipDoneCount: nextSipDoneCount,
      sipOnPaceCount: session.sipOnPaceCount + (onPace ? 1 : 0),
      fastSipCount: session.fastSipCount + (tooFast ? 1 : 0),
      warning,
    });

    if (tooFast) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      Alert.alert('少し早いです', '急がず、次の通知まで待ちましょう。水を一口挟むのがおすすめです。');
    } else {
      Haptics.selectionAsync().catch(() => undefined);
    }
  };

  const markWaterDone = () => {
    if (!session) return;
    setSession({
      ...session,
      waterDoneCount: session.waterDoneCount + 1,
    });
    Haptics.selectionAsync().catch(() => undefined);
  };

  const pauseSession = async () => {
    if (!session || session.status !== 'active') return;
    await cancelNotifications(session.notificationIds);
    setSession({
      ...session,
      status: 'paused',
      pauseStartedAt: new Date().toISOString(),
      notificationIds: [],
      warning: '一時停止中です。再開するまで通知は止まっています。',
    });
  };

  const resumeSession = async () => {
    if (!session || session.status !== 'paused') return;
    const current = getAutoCurrentDrink(session);
    const autoSipIndex = getAutoSipIndex(session);
    const remainingSips = Math.max(session.sipReminderCount - autoSipIndex, 0);
    const notificationIds: string[] = [];

    if (current && remainingSips > 0) {
      const granted = await ensureNotificationAccess();
      if (granted) {
        let delaySeconds = 0;
        for (let i = autoSipIndex; i < session.sipReminderCount; i += 1) {
          const drinkForSip = getDrinkForSipIndex(session, i);
          if (!drinkForSip) break;
          delaySeconds += drinkForSip.sipIntervalMinutes * 60;
          const id = await scheduleLocalNotification(
            '次の一口のタイミング',
            '再開後もゆっくり一口ずつ進めましょう。',
            delaySeconds,
            'sip',
          );
          notificationIds.push(id);
        }
      }
    }

    const pausedForMs = session.pauseStartedAt
      ? Date.now() - new Date(session.pauseStartedAt).getTime()
      : 0;

    setSession({
      ...session,
      status: 'active',
      pausedTotalMs: session.pausedTotalMs + pausedForMs,
      pauseStartedAt: undefined,
      notificationIds,
      autoSipIndex,
      nextSipStartedAt: new Date().toISOString(),
      nextSipDueAt:
        current && remainingSips > 0
          ? addMinutes(Date.now(), current.sipIntervalMinutes).toISOString()
          : undefined,
      warning: undefined,
    });
  };

  const endSession = async () => {
    if (!session) return;
    await cancelNotifications(session.notificationIds);
    const endedAt = new Date().toISOString();
    const durationMinutes = getSessionDurationMinutes({ ...session, endedAt }, Date.now());
    const entry: HistoryEntry = {
      id: `history-${Date.now()}`,
      dateKey: toDateKey(new Date(session.startedAt)),
      mode: session.mode,
      startedAt: session.startedAt,
      endedAt,
      durationMinutes,
      totalPureAlcoholGrams: session.totalPureAlcoholGrams,
      sipReminderCount: session.sipReminderCount,
      sipDoneCount: session.sipDoneCount,
      sipAdherenceRate: getSipAdherenceRate(session.sipDoneCount, session.sipOnPaceCount),
      fastSipCount: session.fastSipCount,
      waterReminderCount: session.waterReminderCount,
      waterDoneCount: session.waterDoneCount,
      drinks: session.drinks,
      nextDayMemo: '',
    };

    setHistory((items) => [entry, ...items].slice(0, 60));
    setSession(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };

  const updateHistoryMemo = (id: string, nextDayMemo: string) => {
    setHistory((items) => items.map((item) => (item.id === id ? { ...item, nextDayMemo } : item)));
  };

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Yoipaceを準備中...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.appName}>Yoipace</Text>
          <Text style={styles.subtitle}>酔い方ペースメーカー</Text>
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>安全メモ</Text>
          <Text style={styles.noticeText}>
            医療機器ではなく、血中アルコール濃度を正確に予測するものではありません。飲酒運転可否の判断には使えません。
          </Text>
        </View>

        {isEditingProfile || !profile ? (
          <Card title="初回プロフィール">
            <Field label="年齢">
              <TextInput
                keyboardType="number-pad"
                onChangeText={(age) => setProfileDraft({ ...profileDraft, age })}
                placeholder="例: 35"
                style={styles.input}
                value={profileDraft.age}
              />
            </Field>
            <Field label="性別">
              <ChoiceGroup options={GENDERS} value={profileDraft.gender} onChange={(gender) => setProfileDraft({ ...profileDraft, gender })} />
            </Field>
            <View style={styles.row}>
              <Field label="身長 cm" style={styles.half}>
                <TextInput
                  keyboardType="decimal-pad"
                  onChangeText={(heightCm) => setProfileDraft({ ...profileDraft, heightCm })}
                  placeholder="170"
                  style={styles.input}
                  value={profileDraft.heightCm}
                />
              </Field>
              <Field label="体重 kg" style={styles.half}>
                <TextInput
                  keyboardType="decimal-pad"
                  onChangeText={(weightKg) => setProfileDraft({ ...profileDraft, weightKg })}
                  placeholder="65"
                  style={styles.input}
                  value={profileDraft.weightKg}
                />
              </Field>
            </View>
            <Field label="普段の飲酒頻度">
              <ChoiceGroup options={DRINKING_FREQUENCIES} value={profileDraft.frequency} onChange={(frequency) => setProfileDraft({ ...profileDraft, frequency })} />
            </Field>
            <Field label="顔が赤くなりやすいか">
              <ChoiceGroup options={FLUSH_LEVELS} value={profileDraft.flush} onChange={(flush) => setProfileDraft({ ...profileDraft, flush })} />
            </Field>
            <Field label="今日の体調">
              <ChoiceGroup options={CONDITIONS} value={profileDraft.condition} onChange={(condition) => setProfileDraft({ ...profileDraft, condition })} />
            </Field>
            <PrimaryButton label="プロフィール保存" onPress={saveProfile} />
          </Card>
        ) : (
          <Card title="プロフィール">
            <Text style={styles.summaryText}>
              {profile.age}歳 / {profile.gender} / {profile.heightCm}cm / {profile.weightKg}kg / {profile.condition}
            </Text>
            <SecondaryButton
              label="編集"
              onPress={() => {
                setProfileDraft(profileToDraft(profile));
                setIsEditingProfile(true);
              }}
            />
          </Card>
        )}

        {profile ? (
          <>
            <Card title="飲酒モード">
              <ChoiceGroup options={DRINKING_MODES} value={selectedMode} onChange={setSelectedMode} />
              <Text style={styles.modeNote}>{MODE_SETTINGS[selectedMode].note}</Text>
            </Card>

            <Card title="お酒登録">
              <Field label="お酒の種類">
                <TextInput
                  onChangeText={(kind) => setDrinkDraft({ ...drinkDraft, kind })}
                  placeholder="ビール"
                  style={styles.input}
                  value={drinkDraft.kind}
                />
                <View style={styles.suggestionWrap}>
                  {DRINK_KIND_SUGGESTIONS.map((kind) => (
                    <Pressable
                      key={kind}
                      onPress={() => setDrinkDraft({ ...drinkDraft, kind })}
                      style={styles.suggestion}
                    >
                      <Text style={styles.suggestionText}>{kind}</Text>
                    </Pressable>
                  ))}
                </View>
              </Field>
              <View style={styles.row}>
                <Field label="量 ml" style={styles.third}>
                  <TextInput
                    keyboardType="decimal-pad"
                    onChangeText={(volumeMl) => setDrinkDraft({ ...drinkDraft, volumeMl })}
                    placeholder="350"
                    style={styles.input}
                    value={drinkDraft.volumeMl}
                  />
                </Field>
                <Field label="度数 %" style={styles.third}>
                  <TextInput
                    keyboardType="decimal-pad"
                    onChangeText={(abvPercent) => setDrinkDraft({ ...drinkDraft, abvPercent })}
                    placeholder="5"
                    style={styles.input}
                    value={drinkDraft.abvPercent}
                  />
                </Field>
                <Field label="想定一口数" style={styles.third}>
                  <TextInput
                    keyboardType="number-pad"
                    onChangeText={(sips) => setDrinkDraft({ ...drinkDraft, sips })}
                    placeholder="8"
                    style={styles.input}
                    value={drinkDraft.sips}
                  />
                </Field>
              </View>

              {plannedDrink ? (
                <View style={styles.planBox}>
                  <Metric label="純アルコール量" value={`${plannedDrink.pureAlcoholGrams}g`} />
                  <Metric label="飲み切り目安" value={`約${plannedDrink.recommendedMinutes}分`} />
                  <Metric label="一口間隔" value={`約${plannedDrink.sipIntervalMinutes}分`} />
                  <Metric label="水通知" value={`${plannedDrink.waterReminderCount}回`} />
                </View>
              ) : (
                <Text style={styles.muted}>お酒の量、度数、一口数を入力すると目安が出ます。</Text>
              )}

              <View style={styles.buttonRow}>
                <PrimaryButton
                  label={session ? '一杯追加' : '飲酒開始'}
                  onPress={session ? addDrink : startSession}
                  disabled={!plannedDrink}
                />
                <SecondaryButton label="入力リセット" onPress={() => setDrinkDraft(emptyDrinkDraft)} />
              </View>
            </Card>
          </>
        ) : null}

        {session ? (
          <Card title="現在のセッション">
            <View style={styles.statusLine}>
              <Text style={styles.statusBadge}>{session.status === 'active' ? '進行中' : '一時停止'}</Text>
              <Text style={styles.statusText}>{session.mode}</Text>
            </View>

            {session.warning ? <Text style={styles.warningText}>{session.warning}</Text> : null}
            {paceCaution ? <Text style={styles.warningText}>{paceCaution}</Text> : null}

            {sipTimer ? (
              <View style={styles.timerPanel}>
                <View style={styles.timerHeader}>
                  <Text style={styles.timerLabel}>次の一口まで</Text>
                  <Text style={[styles.timerState, sipTimer.isReady && styles.timerStateReady]}>
                    {sipTimer.statusLabel}
                  </Text>
                </View>
                <Text style={styles.timerValue}>{sipTimer.remainingLabel}</Text>
                <View style={styles.timerProgressTrack}>
                  <View
                    style={[
                      styles.timerProgressFill,
                      sipTimer.isReady && styles.timerProgressReady,
                      { width: `${sipTimer.progressPercent}%` },
                    ]}
                  />
                </View>
                <View style={styles.timerFooter}>
                  <Text style={styles.timerHint}>{sipTimer.hint}</Text>
                  <Text style={styles.timerClock}>{sipTimer.nextClockLabel}</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.planBox}>
              <Metric label="当日合計" value={`${session.totalPureAlcoholGrams}g`} />
              <Metric label="飲酒時間" value={`${activeDurationMinutes}分`} />
              <Metric label="水通知回数" value={`${session.waterReminderCount}回`} />
              <Metric label="遵守率" value={`${adherenceRate}%`} />
            </View>

            <View style={styles.sessionDetail}>
              <Text style={styles.detailText}>
                次の一口: {session.nextSipDueAt ? formatClock(new Date(session.nextSipDueAt)) : '完了'}
              </Text>
              <Text style={styles.detailText}>
                一口: {session.sipDoneCount}/{session.sipReminderCount} / 水: {session.waterDoneCount}
                /{session.waterReminderCount}
              </Text>
              {currentDrink ? (
                <Text style={styles.detailText}>
                  現在: {currentDrink.kind} {currentDrink.volumeMl}ml {currentDrink.abvPercent}%
                </Text>
              ) : null}
              <Text style={styles.detailText}>通知: {notificationStatus}</Text>
            </View>

            <View style={styles.buttonRow}>
              <PrimaryButton
                label="一口を記録"
                onPress={markSipDone}
                disabled={session.status !== 'active'}
              />
              <SecondaryButton label="水を飲んだ" onPress={markWaterDone} />
            </View>
            <View style={styles.buttonRow}>
              {session.status === 'active' ? (
                <SecondaryButton label="一時停止" onPress={pauseSession} />
              ) : (
                <SecondaryButton label="再開" onPress={resumeSession} />
              )}
              <DangerButton label="飲酒終了" onPress={endSession} />
            </View>
          </Card>
        ) : null}

        <Card title="履歴">
          {history.length === 0 ? (
            <Text style={styles.muted}>まだ履歴はありません。</Text>
          ) : (
            history.map((item) => (
              <View key={item.id} style={styles.historyItem}>
                <Text style={styles.historyTitle}>
                  {item.dateKey} / {item.mode}
                </Text>
                <Text style={styles.detailText}>
                  純アルコール {item.totalPureAlcoholGrams}g / {item.durationMinutes}分 / 遵守率{' '}
                  {item.sipAdherenceRate}%
                </Text>
                <Text style={styles.detailText}>
                  {item.drinks.map((drink) => `${drink.kind}${drink.volumeMl}ml`).join('、')}
                </Text>
                <TextInput
                  multiline
                  onChangeText={(nextDayMemo) => updateHistoryMemo(item.id, nextDayMemo)}
                  placeholder="翌日の体調メモ"
                  style={[styles.input, styles.memoInput]}
                  value={item.nextDayMemo}
                />
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  children,
  label,
  style,
}: {
  children: React.ReactNode;
  label: string;
  style?: object;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Card({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChoiceGroup<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
}) {
  return (
    <View style={styles.choiceWrap}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.choice, option === value && styles.choiceSelected]}
        >
          <Text style={[styles.choiceText, option === value && styles.choiceTextSelected]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function PrimaryButton({
  disabled,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, styles.primaryButton, disabled && styles.disabledButton]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, styles.secondaryButton]}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function DangerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, styles.dangerButton]}>
      <Text style={styles.dangerButtonText}>{label}</Text>
    </Pressable>
  );
}

function parseProfileDraft(
  draft: typeof emptyProfileDraft,
  previous: Profile | null,
): Profile | null {
  const age = Number(draft.age);
  const heightCm = Number(draft.heightCm);
  const weightKg = Number(draft.weightKg);

  if (!Number.isFinite(age) || !Number.isFinite(heightCm) || !Number.isFinite(weightKg)) {
    Alert.alert('入力を確認してください', '年齢、身長、体重は数値で入力してください。');
    return null;
  }
  if (age <= 0 || heightCm <= 0 || weightKg <= 0) {
    Alert.alert('入力を確認してください', '年齢、身長、体重は0より大きい値にしてください。');
    return null;
  }

  const now = new Date().toISOString();
  return {
    age,
    gender: draft.gender,
    heightCm,
    weightKg,
    frequency: draft.frequency,
    flush: draft.flush,
    condition: draft.condition,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

function profileToDraft(profile: Profile) {
  return {
    age: String(profile.age),
    gender: profile.gender,
    heightCm: String(profile.heightCm),
    weightKg: String(profile.weightKg),
    frequency: profile.frequency,
    flush: profile.flush,
    condition: profile.condition,
  };
}

function parseDrinkDraft(draft: DrinkDraft) {
  const volumeMl = Number(draft.volumeMl);
  const abvPercent = Number(draft.abvPercent);
  const sips = Number(draft.sips);

  if (!draft.kind.trim()) return null;
  if (!Number.isFinite(volumeMl) || !Number.isFinite(abvPercent) || !Number.isFinite(sips)) return null;
  if (volumeMl <= 0 || abvPercent <= 0 || abvPercent > 96 || sips <= 0) return null;

  return {
    kind: draft.kind,
    volumeMl,
    abvPercent,
    sips: Math.max(1, Math.round(sips)),
  };
}

async function scheduleLocalNotification(
  title: string,
  body: string,
  seconds: number,
  kind: NotificationKind,
) {
  const isWater = kind === 'water';

  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { kind },
      sound: true,
      vibrate: isWater ? [0, 120, 120, 360] : [0, 180],
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      channelId: isWater ? WATER_CHANNEL_ID : SIP_CHANNEL_ID,
      seconds: Math.max(1, Math.round(seconds)),
    },
  });
}

async function cancelNotifications(ids: string[]) {
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

function getCurrentDrink(session: Pick<DrinkingSession, 'drinks' | 'sipDoneCount'>) {
  let passed = session.sipDoneCount;
  for (const drink of session.drinks) {
    if (passed < drink.sips) return drink;
    passed -= drink.sips;
  }
  return session.drinks.at(-1) ?? null;
}

function createSessionDrink(drink: DrinkRecord): DrinkRecord {
  return {
    ...drink,
    id: `drink-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    addedAt: new Date().toISOString(),
  };
}

function getAutoSipIndex(session: DrinkingSession) {
  return Math.min(session.autoSipIndex ?? 0, session.sipReminderCount);
}

function getAutoCurrentDrink(session: DrinkingSession) {
  return getDrinkForSipIndex(session, getAutoSipIndex(session));
}

function getDrinkForSipIndex(session: Pick<DrinkingSession, 'drinks'>, sipIndex: number) {
  if (sipIndex < 0) return null;

  let passed = sipIndex;
  for (const drink of session.drinks) {
    if (passed < drink.sips) return drink;
    passed -= drink.sips;
  }

  return null;
}

function getRemainingAutoSipQueueSeconds(session: DrinkingSession, nowMs: number) {
  const autoSipIndex = getAutoSipIndex(session);
  if (!session.nextSipDueAt || autoSipIndex >= session.sipReminderCount) return 0;

  let dueMs = new Date(session.nextSipDueAt).getTime();
  for (let index = autoSipIndex + 1; index < session.sipReminderCount; index += 1) {
    const drink = getDrinkForSipIndex(session, index);
    if (!drink) break;
    dueMs += drink.sipIntervalMinutes * 60000;
  }

  return Math.max(0, Math.ceil((dueMs - nowMs) / 1000));
}

function advanceAutoSipCountdown(session: DrinkingSession, nowMs: number): DrinkingSession {
  if (!session.nextSipDueAt) return session;

  let previousDueMs = new Date(session.nextSipDueAt).getTime();
  let nextDueMs = previousDueMs;
  let nextSipIndex = getAutoSipIndex(session) + 1;

  while (nextSipIndex < session.sipReminderCount) {
    const drink = getDrinkForSipIndex(session, nextSipIndex);
    if (!drink) break;

    nextDueMs += drink.sipIntervalMinutes * 60000;
    if (nextDueMs > nowMs) {
      return {
        ...session,
        autoSipIndex: nextSipIndex,
        nextSipStartedAt: new Date(previousDueMs).toISOString(),
        nextSipDueAt: new Date(nextDueMs).toISOString(),
      };
    }

    previousDueMs = nextDueMs;
    nextSipIndex += 1;
  }

  return {
    ...session,
    autoSipIndex: session.sipReminderCount,
    nextSipStartedAt: new Date(previousDueMs).toISOString(),
    nextSipDueAt: undefined,
  };
}

function wasRecentlyDue(session: DrinkingSession, nowMs: number) {
  if (!session.nextSipStartedAt) return false;

  const previousDueMs = new Date(session.nextSipStartedAt).getTime();
  return nowMs >= previousDueMs && nowMs - previousDueMs <= 10 * 60000;
}

function getSipTimerState(
  session: DrinkingSession,
  currentDrink: DrinkRecord | null,
  nowMs: number,
) {
  if (!session.nextSipDueAt || getAutoSipIndex(session) >= session.sipReminderCount || !currentDrink) {
    return {
      hint: 'この一杯の一口ペースは完了です。',
      isReady: true,
      nextClockLabel: '次の一杯を追加するか終了',
      progressPercent: 100,
      remainingLabel: '完了',
      statusLabel: '完了',
    };
  }

  if (session.status === 'paused') {
    return {
      hint: '再開するまで通知とタイマーは止まっています。',
      isReady: false,
      nextClockLabel: `予定 ${formatClock(new Date(session.nextSipDueAt))}`,
      progressPercent: 0,
      remainingLabel: '一時停止中',
      statusLabel: '停止中',
    };
  }

  const dueMs = new Date(session.nextSipDueAt).getTime();
  const remainingSeconds = Math.ceil((dueMs - nowMs) / 1000);
  const totalSeconds = Math.max(1, Math.round(currentDrink.sipIntervalMinutes * 60));
  const elapsedSeconds = totalSeconds - Math.max(remainingSeconds, 0);
  const progressPercent = Math.max(0, Math.min(100, Math.round((elapsedSeconds / totalSeconds) * 100)));

  if (remainingSeconds <= 0) {
    return {
      hint: '急がず一口だけ。記録したい時だけ「一口を記録」を押してください。',
      isReady: true,
      nextClockLabel: `予定 ${formatClock(new Date(session.nextSipDueAt))}`,
      progressPercent: 100,
      remainingLabel: '今、一口OK',
      statusLabel: 'タイミング',
    };
  }

  return {
    hint: '通知まで待つと、今日のペースを守りやすくなります。',
    isReady: false,
    nextClockLabel: `予定 ${formatClock(new Date(session.nextSipDueAt))}`,
    progressPercent,
    remainingLabel: formatRemainingTime(remainingSeconds),
    statusLabel: '待つ',
  };
}

function getSessionDurationMinutes(session: DrinkingSession, nowMs: number) {
  const endMs = session.endedAt ? new Date(session.endedAt).getTime() : nowMs;
  const activePauseMs =
    session.status === 'paused' && session.pauseStartedAt
      ? nowMs - new Date(session.pauseStartedAt).getTime()
      : 0;
  const durationMs = endMs - new Date(session.startedAt).getTime() - session.pausedTotalMs - activePauseMs;
  return Math.max(0, Math.round(durationMs / 60000));
}

function addMinutes(baseMs: number, minutes: number) {
  return new Date(baseMs + minutes * 60000);
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function formatClock(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatRemainingTime(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(restSeconds).padStart(2, '0')}`;
}

function roundSessionGrams(value: number) {
  return Math.round(value * 10) / 10;
}

const styles = StyleSheet.create({
  appName: {
    color: '#13261F',
    fontSize: 34,
    fontWeight: '800',
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    flexGrow: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E2DC',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  cardTitle: {
    color: '#13261F',
    fontSize: 18,
    fontWeight: '800',
  },
  choice: {
    backgroundColor: '#F5F7F6',
    borderColor: '#D8E2DC',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  choiceSelected: {
    backgroundColor: '#184E45',
    borderColor: '#184E45',
  },
  choiceText: {
    color: '#41524B',
    fontSize: 14,
    fontWeight: '700',
  },
  choiceTextSelected: {
    color: '#FFFFFF',
  },
  choiceWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 40,
  },
  dangerButton: {
    backgroundColor: '#FFF0ED',
    borderColor: '#C4493D',
    borderWidth: 1,
  },
  dangerButtonText: {
    color: '#A43228',
    fontSize: 15,
    fontWeight: '800',
  },
  detailText: {
    color: '#4D5F58',
    fontSize: 14,
    lineHeight: 20,
  },
  disabledButton: {
    opacity: 0.45,
  },
  field: {
    gap: 7,
  },
  half: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  header: {
    gap: 4,
    paddingTop: 8,
  },
  historyItem: {
    borderTopColor: '#E4ECE8',
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 12,
  },
  historyTitle: {
    color: '#13261F',
    fontSize: 15,
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#F9FBFA',
    borderColor: '#C9D6D0',
    borderRadius: 8,
    borderWidth: 1,
    color: '#13261F',
    fontSize: 16,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: {
    color: '#33443D',
    fontSize: 13,
    fontWeight: '800',
  },
  loading: {
    alignItems: 'center',
    backgroundColor: '#F4F7F5',
    flex: 1,
    justifyContent: 'center',
  },
  loadingText: {
    color: '#13261F',
    fontSize: 16,
    fontWeight: '700',
  },
  memoInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  metric: {
    backgroundColor: '#F4F7F5',
    borderRadius: 8,
    flexBasis: '47%',
    flexGrow: 1,
    padding: 12,
  },
  metricLabel: {
    color: '#60726B',
    fontSize: 12,
    fontWeight: '700',
  },
  metricValue: {
    color: '#13261F',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  modeNote: {
    color: '#4D5F58',
    fontSize: 14,
    lineHeight: 20,
  },
  muted: {
    color: '#687A73',
    fontSize: 14,
    lineHeight: 20,
  },
  notice: {
    backgroundColor: '#FFF9E8',
    borderColor: '#E8D79C',
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  noticeText: {
    color: '#594A18',
    fontSize: 13,
    lineHeight: 19,
  },
  noticeTitle: {
    color: '#3D3210',
    fontSize: 14,
    fontWeight: '800',
  },
  planBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryButton: {
    backgroundColor: '#184E45',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  screen: {
    backgroundColor: '#F4F7F5',
    flex: 1,
  },
  secondaryButton: {
    backgroundColor: '#EEF4F1',
    borderColor: '#C9D6D0',
    borderWidth: 1,
  },
  secondaryButtonText: {
    color: '#184E45',
    fontSize: 15,
    fontWeight: '800',
  },
  sessionDetail: {
    gap: 4,
  },
  statusBadge: {
    backgroundColor: '#184E45',
    borderRadius: 8,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  statusText: {
    color: '#33443D',
    fontSize: 15,
    fontWeight: '800',
  },
  subtitle: {
    color: '#41524B',
    fontSize: 16,
    fontWeight: '700',
  },
  suggestion: {
    backgroundColor: '#EEF4F1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  suggestionText: {
    color: '#184E45',
    fontSize: 13,
    fontWeight: '700',
  },
  suggestionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  summaryText: {
    color: '#33443D',
    fontSize: 15,
    lineHeight: 22,
  },
  third: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 92,
  },
  timerClock: {
    color: '#60726B',
    fontSize: 12,
    fontWeight: '700',
  },
  timerFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  timerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timerHint: {
    color: '#4D5F58',
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  timerLabel: {
    color: '#33443D',
    fontSize: 13,
    fontWeight: '800',
  },
  timerPanel: {
    backgroundColor: '#F7FAF8',
    borderColor: '#C9D6D0',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  timerProgressFill: {
    backgroundColor: '#1F7A68',
    borderRadius: 999,
    height: '100%',
  },
  timerProgressReady: {
    backgroundColor: '#D8892A',
  },
  timerProgressTrack: {
    backgroundColor: '#DDE7E2',
    borderRadius: 999,
    height: 12,
    overflow: 'hidden',
  },
  timerState: {
    backgroundColor: '#E6EFEB',
    borderRadius: 8,
    color: '#184E45',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  timerStateReady: {
    backgroundColor: '#FFF1D9',
    color: '#8A5217',
  },
  timerValue: {
    color: '#13261F',
    fontSize: 42,
    fontWeight: '800',
  },
  warningText: {
    backgroundColor: '#FFF0ED',
    borderColor: '#E8B8B1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#87382E',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    padding: 10,
  },
});
