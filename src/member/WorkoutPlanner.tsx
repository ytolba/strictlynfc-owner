import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button, Chip, Field, Notice, SectionTitle } from '../ui';
import { IconBack, PageHeader } from '../shell';
import { colors, fonts } from '../theme';
import { useReduceMotion } from '../motion';
import { supabase } from '../supabase';
import { ensureMemberSession } from './session';
import type { MemberPreferences, PartnerGym, WorkoutSession } from './types';

export type PlannedExercise = {
  publicId: string; exerciseSlug: string | null; name: string; stationName: string; stationCode: string;
  primaryMuscles: string[]; targetArea?: string; sets: number; reps: string;
};
export type DailyPlan = {
  gymId: string; gymName: string; createdAt: string; validUntil: string; focus: string; intent: string; durationMinutes: number;
  coverage?: { covered: string[]; deferred?: string[]; missing: string[] };
  pacing?: { totalSets: number; estimatedMinutes: number; emphasis: string; recovery: string };
  exercises: PlannedExercise[];
};
const PLAN_PREFIX = 'strictlyvision.member.daily-plan.v2.';
const TIME_OPTIONS = [20, 30, 45, 60, 75, 90];
const FOCUS_SUGGESTIONS = ['Shoulders and back', 'Chest and triceps', 'Legs', 'Full body'];
const planKey = (userId: string, gymId: string) => `${PLAN_PREFIX}${userId}.${gymId}`;

function isPlan(value: unknown): value is DailyPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as DailyPlan;
  return typeof plan.gymId === 'string' && typeof plan.createdAt === 'string' && typeof plan.validUntil === 'string'
    && Number.isFinite(Date.parse(plan.validUntil)) && Array.isArray(plan.exercises)
    && plan.exercises.every((item) => typeof item.publicId === 'string' && typeof item.name === 'string' && Number.isInteger(item.sets));
}

async function loadDailyPlan(userId: string, gymId: string): Promise<DailyPlan | null> {
  try {
    const raw = await AsyncStorage.getItem(planKey(userId, gymId));
    if (!raw) return null;
    const plan = JSON.parse(raw);
    return isPlan(plan) && plan.gymId === gymId && Date.parse(plan.validUntil) > Date.now() ? plan : null;
  } catch { return null; }
}

export async function clearDailyPlan() {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PLAN_PREFIX) || key === 'strictlyvision.member.daily-plan.v1');
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

export function WorkoutPlanner({ gyms, preferences, userId, workout, onBack, onOpen }: {
  gyms: PartnerGym[]; preferences: MemberPreferences; userId: string | null; workout: WorkoutSession | null;
  onBack: () => void; onOpen: (publicId: string, exerciseSlug?: string) => void;
}) {
  const preferred = gyms.find((gym) => preferences.favoriteGymIds.includes(gym.id)) || gyms[0];
  const [gymId, setGymId] = useState(preferred?.id || '');
  const [focus, setFocus] = useState('');
  const [duration, setDuration] = useState(45);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const reducedMotion = useReduceMotion();
  const reveal = useRef(new Animated.Value(1)).current;

  useEffect(() => () => reveal.stopAnimation(), [reveal]);
  useEffect(() => { if (reducedMotion) { reveal.stopAnimation(); reveal.setValue(1); } }, [reducedMotion, reveal]);

  useEffect(() => {
    if (!gymId || !gyms.some((gym) => gym.id === gymId)) setGymId(preferred?.id || '');
  }, [gymId, gyms, preferred?.id]);

  useEffect(() => {
    let current = true;
    setPlan(null);
    if (!userId || !gymId) return () => { current = false; };
    (async () => {
      const cached = await loadDailyPlan(userId, gymId);
      if (current) {
        setPlan(cached);
        if (cached) { setFocus((value) => value || cached.focus); setDuration(cached.durationMinutes); }
      }
      try {
        const { data, error } = await supabase.functions.invoke('generate-workout', { body: { action: 'today', gymId } });
        if (!current || error) return;
        const today = isPlan(data?.plan) && data.plan.gymId === gymId && Date.parse(data.plan.validUntil) > Date.now() ? data.plan : null;
        if (today) await AsyncStorage.setItem(planKey(userId, gymId), JSON.stringify(today));
        if (current) {
          setPlan(today);
          if (today) { setFocus((value) => value || today.focus); setDuration(today.durationMinutes); }
        }
      } catch { /* Keep the cached plan while offline. */ }
    })();
    return () => { current = false; };
  }, [userId, gymId]);

  const generate = async () => {
    if (!gymId || focus.trim().length < 2) return setMessage('Choose a gym and tell us what you want to train.');
    setBusy(true); setMessage('');
    try {
      await ensureMemberSession();
      const { data: auth } = await supabase.auth.getSession();
      if (!auth.session) throw new Error('An internet connection is needed to create a plan. You can still scan and log sets offline.');
      let result: DailyPlan | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const { data, error } = await supabase.functions.invoke('generate-workout', {
          body: { action: 'generate', gymId, focus: focus.trim(), durationMinutes: duration }
        });
        if (error) {
          const detail = await error.context?.json?.().catch(() => null);
          throw new Error(detail?.error || error.message || 'Workout planning is unavailable.');
        }
        if (isPlan(data?.plan)) { result = data.plan; break; }
        if (!data?.pending || attempt === 3) throw new Error('The workout response was incomplete. Please try again.');
        await new Promise((resolve) => setTimeout(resolve, Math.min(Number(data.retryAfterSeconds) || 3, 5) * 1000));
      }
      if (!result || result.gymId !== gymId) throw new Error('The workout response was incomplete. Please try again.');
      await AsyncStorage.setItem(planKey(auth.session.user.id, gymId), JSON.stringify(result));
      setPlan(result);
      if (!reducedMotion) {
        reveal.stopAnimation(); reveal.setValue(0.7);
        Animated.timing(reveal, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not create a workout.'); }
    setBusy(false);
  };

  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <IconBack onPress={onBack} />
      <PageHeader title="Today’s plan" />
      <Text style={styles.copy}>Tell us what you’re training and how long you have. Your plan will use equipment at this gym.</Text>

      <SectionTitle>Your gym</SectionTitle>
      <View style={styles.chips}>{gyms.map((gym) => <Chip key={gym.id} label={gym.name} selected={gym.id === gymId} onPress={() => setGymId(gym.id)} />)}</View>
      <Field label="What do you want to train?" placeholder="e.g. shoulders and back" value={focus} onChangeText={setFocus} maxLength={160} returnKeyType="done" />
      <View style={styles.suggestions}>{FOCUS_SUGGESTIONS.map((example) => <Chip key={example} label={example} selected={focus.toLowerCase() === example.toLowerCase()} onPress={() => setFocus(example)} />)}</View>
      <SectionTitle>Time available</SectionTitle>
      <View style={styles.chips}>{TIME_OPTIONS.map((minutes) => <Chip key={minutes} label={`${minutes} min`} selected={duration === minutes} onPress={() => setDuration(minutes)} />)}</View>
      <Text style={styles.timeHint}>Shorter plans cover the biggest priorities with fewer sets. You can always extend the workout.</Text>
      <Button label={plan?.gymId === gymId ? 'Build a new plan' : 'Build my workout'} onPress={generate} loading={busy} disabled={!gymId || focus.trim().length < 2} />
      {busy ? <Text style={styles.status} accessibilityLiveRegion="polite">Matching exercises to your gym…</Text> : null}
      {message ? <Notice tone="danger">{message}</Notice> : null}
      {plan?.gymId === gymId && Date.parse(plan.validUntil) > Date.now() ? <Animated.View style={[styles.plan, { opacity: reveal }]}>
        <View style={styles.planHeader}><Text accessibilityRole="header" style={styles.planTitle}>Your {plan.focus} workout</Text><Text style={styles.planMeta}>{plan.gymName} · {plan.durationMinutes} min available</Text></View>
        <View style={styles.summary}><Text style={styles.summaryNumber}>{plan.exercises.length}</Text><Text style={styles.summaryLabel}>exercises</Text><View style={styles.summaryDivider} /><Text style={styles.summaryNumber}>{plan.pacing?.totalSets ?? plan.exercises.reduce((total, item) => total + item.sets, 0)}</Text><Text style={styles.summaryLabel}>working sets</Text>{plan.pacing ? <><View style={styles.summaryDivider} /><Text style={styles.summaryNumber}>~{plan.pacing.estimatedMinutes}</Text><Text style={styles.summaryLabel}>min planned</Text></> : null}</View>
        {plan.coverage ? <View style={styles.coverage}>
          <Text style={styles.coverageTitle}>Today’s priorities · {plan.coverage.covered.length}/{plan.coverage.covered.length + (plan.coverage.deferred?.length || 0) + plan.coverage.missing.length} areas</Text>
          <View style={styles.areaList}>{plan.coverage.covered.map((area) => <View key={area} style={styles.areaTag}><Ionicons name="checkmark" size={14} color={colors.lime} /><Text style={styles.areaTagText}>{area}</Text></View>)}</View>
          {plan.coverage.deferred?.length ? <Text style={styles.deferred}>For a longer workout: {plan.coverage.deferred.join(' · ')}</Text> : null}
          {plan.coverage.missing.length ? <Notice tone="danger">No matching equipment at this gym for: {plan.coverage.missing.join(', ')}.</Notice> : null}
        </View> : null}
        {plan.pacing ? <View style={styles.pacing}><Text style={styles.pacingTitle}>How to train today</Text><Text style={styles.pacingCopy}>{plan.pacing.emphasis}</Text><Text style={styles.pacingCopy}>{plan.pacing.recovery}</Text></View> : <Text style={styles.copy}>Suggested sets and reps are a starting point. Choose a comfortable load and adjust to your ability.</Text>}
        {plan.exercises.map((item, index) => {
          const logged = workout?.sets.filter((set) => set.publicId === item.publicId && (set.exerciseSlug || '') === (item.exerciseSlug || '')).length || 0;
          return <Pressable key={`${item.publicId}:${item.exerciseSlug || ''}`} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.sets} working sets of ${item.reps} reps, station ${item.stationCode}`} onPress={() => onOpen(item.publicId, item.exerciseSlug || undefined)} style={styles.exercise}>
            <View style={styles.index}><Text style={styles.indexText}>{index + 1}</Text></View>
            <View style={styles.exerciseBody}><Text style={styles.exerciseName}>{item.name}</Text>{item.targetArea ? <Text style={styles.targetArea}>{item.targetArea}</Text> : null}<Text style={styles.exerciseMeta}>{item.sets} sets × {item.reps} reps · Station {item.stationCode}</Text>{logged > 0 ? <Text style={styles.logged}>{logged} set{logged === 1 ? '' : 's'} logged</Text> : null}</View>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </Pressable>;
        })}
      </Animated.View> : null}
      <Text style={styles.disclaimer}>Planning is general fitness guidance, not a medical or injury-rehabilitation program. Stop if an exercise causes pain.</Text>
    </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.forest }, flex: { flex: 1 }, screen: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, paddingBottom: 48, gap: 20 },
  copy: { color: colors.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -10 },
  timeHint: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: -10 },
  status: { color: colors.lime, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center' },
  plan: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  planHeader: { gap: 5 }, planTitle: { color: colors.cream, fontFamily: fonts.bold, fontSize: 21 }, planMeta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  summary: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 5, paddingVertical: 11, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  summaryNumber: { color: colors.lime, fontFamily: fonts.bold, fontSize: 20 }, summaryLabel: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, marginRight: 7 }, summaryDivider: { width: 1, height: 14, backgroundColor: colors.borderStrong, marginHorizontal: 2 },
  coverage: { gap: 7, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  coverageTitle: { color: colors.cream, fontFamily: fonts.semibold, fontSize: 14 },
  areaList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  areaTag: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: colors.bg },
  areaTagText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  deferred: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  pacing: { backgroundColor: colors.bg, borderRadius: 12, padding: 14, gap: 7 }, pacingTitle: { color: colors.cream, fontFamily: fonts.semibold, fontSize: 15 }, pacingCopy: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  exercise: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 74, borderTopColor: colors.border, borderTopWidth: 1, paddingVertical: 12 },
  index: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' }, indexText: { color: colors.onLime, fontFamily: fonts.bold, fontSize: 14 },
  exerciseBody: { flex: 1, gap: 3 }, exerciseName: { color: colors.cream, fontFamily: fonts.semibold, fontSize: 16 }, exerciseMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  targetArea: { color: colors.lime, fontFamily: fonts.medium, fontSize: 12 },
  logged: { color: colors.mint, fontFamily: fonts.medium, fontSize: 11 }, disclaimer: { color: colors.dim, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }
});
