import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button, Chip, Field, Notice } from '../ui';
import { BrandMark, IconBack, PageHeader } from '../shell';
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
const FOCUS_OPTIONS: { label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: 'Shoulders and back', icon: 'accessibility-outline' },
  { label: 'Chest and triceps', icon: 'barbell-outline' },
  { label: 'Legs', icon: 'walk-outline' },
  { label: 'Full body', icon: 'body-outline' }
];
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

export function WorkoutPlanner({ gyms, preferences, userId, workout, onOpen }: {
  gyms: PartnerGym[]; preferences: MemberPreferences; userId: string | null; workout: WorkoutSession | null;
  onOpen: (publicId: string, exerciseSlug?: string) => void;
}) {
  const preferred = gyms.find((gym) => preferences.favoriteGymIds.includes(gym.id)) || gyms[0];
  const [gymId, setGymId] = useState(preferred?.id || '');
  const [focus, setFocus] = useState('');
  const [duration, setDuration] = useState(45);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // The finished plan is its own page. It opens straight away when today's plan already exists, and after building a new one.
  const [view, setView] = useState<'form' | 'plan'>('form');
  const autoOpened = useRef(false);
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
        if (cached) { setFocus((value) => value || cached.focus); setDuration(cached.durationMinutes); openExisting(); }
      }
      try {
        const { data, error } = await supabase.functions.invoke('generate-workout', { body: { action: 'today', gymId } });
        if (!current || error) return;
        const today = isPlan(data?.plan) && data.plan.gymId === gymId && Date.parse(data.plan.validUntil) > Date.now() ? data.plan : null;
        if (today) await AsyncStorage.setItem(planKey(userId, gymId), JSON.stringify(today));
        if (current) {
          setPlan(today);
          if (today) { setFocus((value) => value || today.focus); setDuration(today.durationMinutes); openExisting(); }
        }
      } catch { /* Keep the cached plan while offline. */ }
    })();
    return () => { current = false; };
  }, [userId, gymId]);

  function openExisting() {
    if (autoOpened.current) return;
    autoOpened.current = true; setView('plan');
  }

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
      autoOpened.current = true; setView('plan');
      if (!reducedMotion) {
        reveal.stopAnimation(); reveal.setValue(0.7);
        Animated.timing(reveal, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not create a workout.'); }
    setBusy(false);
  };

  const activePlan = plan?.gymId === gymId && Date.parse(plan.validUntil) > Date.now() ? plan : null;
  const gym = gyms.find((item) => item.id === gymId);
  const plannedSets = (item: DailyPlan) => item.pacing?.totalSets ?? item.exercises.reduce((total, exercise) => total + exercise.sets, 0);

  if (view === 'plan' && activePlan) {
    const plan = activePlan;
    const done = plan.exercises.filter((item) => workout?.sets.some((set) => set.publicId === item.publicId && (set.exerciseSlug || '') === (item.exerciseSlug || ''))).length;
    return <ScrollView contentContainerStyle={styles.screen}>
      <IconBack onPress={() => setView('form')} />
      <View style={styles.planHead}>
        <Text style={styles.planMeta}>{plan.gymName} · {plan.durationMinutes} min</Text>
        <Text accessibilityRole="header" style={styles.planTitle}>{plan.focus}</Text>
      </View>
      <Animated.View style={[styles.stats, { opacity: reveal }]}>
        <Stat value={plan.exercises.length} label={plan.exercises.length === 1 ? 'exercise' : 'exercises'} />
        <View style={styles.statDivider} />
        <Stat value={plannedSets(plan)} label="working sets" />
        <View style={styles.statDivider} />
        <Stat value={plan.pacing ? `~${plan.pacing.estimatedMinutes}` : plan.durationMinutes} label="minutes" />
      </Animated.View>

      {plan.coverage?.covered.length ? <View style={styles.areaList}>{plan.coverage.covered.map((area) => <View key={area} style={styles.areaTag}><Ionicons name="checkmark" size={14} color={colors.lime} /><Text style={styles.areaTagText}>{area}</Text></View>)}</View> : null}
      {plan.coverage?.deferred?.length ? <Text style={styles.deferred}>For a longer workout: {plan.coverage.deferred.join(' · ')}</Text> : null}
      {plan.coverage?.missing.length ? <Notice tone="danger">No matching equipment at this gym for: {plan.coverage.missing.join(', ')}.</Notice> : null}

      <View style={styles.listHead}><Text style={styles.sectionLabel}>Exercises</Text>{workout ? <Text style={styles.progress}>{done} of {plan.exercises.length} started</Text> : null}</View>
      <View style={styles.exerciseList}>
        {plan.exercises.map((item, index) => {
          const logged = workout?.sets.filter((set) => set.publicId === item.publicId && (set.exerciseSlug || '') === (item.exerciseSlug || '')).length || 0;
          return <Pressable key={`${item.publicId}:${item.exerciseSlug || ''}`} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.sets} working sets of ${item.reps} reps, station ${item.stationCode}${logged ? `, ${logged} logged` : ''}`} onPress={() => onOpen(item.publicId, item.exerciseSlug || undefined)} style={({ pressed }) => [styles.exercise, index > 0 && styles.exerciseRule, pressed && styles.pressed]}>
            <View style={[styles.index, logged > 0 && styles.indexDone]}>{logged > 0 ? <Ionicons name="checkmark" size={18} color={colors.onLime} /> : <Text style={styles.indexText}>{index + 1}</Text>}</View>
            <View style={styles.exerciseBody}>
              <Text style={styles.exerciseName}>{item.name}</Text>
              <Text style={styles.exerciseMeta}>{item.sets} × {item.reps}{item.targetArea ? ` · ${item.targetArea}` : ''}</Text>
              {logged > 0 ? <Text style={styles.logged}>{logged} set{logged === 1 ? '' : 's'} logged</Text> : null}
            </View>
            <View style={styles.station}><Text style={styles.stationLabel}>Station</Text><Text style={styles.stationCode}>{item.stationCode}</Text></View>
          </Pressable>;
        })}
      </View>

      {plan.pacing ? <View style={styles.pacing}><Text style={styles.pacingTitle}>How to train today</Text><Text style={styles.pacingCopy}>{plan.pacing.emphasis}</Text><Text style={styles.pacingCopy}>{plan.pacing.recovery}</Text></View> : <Text style={styles.copy}>Suggested sets and reps are a starting point. Choose a comfortable load and adjust to your ability.</Text>}
      <Button label="Build a different plan" tone="secondary" onPress={() => setView('form')} />
      <Text style={styles.disclaimer}>Planning is general fitness guidance, not a medical or injury-rehabilitation program. Stop if an exercise causes pain.</Text>
    </ScrollView>;
  }

  const custom = focus.trim().length > 0 && !FOCUS_OPTIONS.some((option) => option.label.toLowerCase() === focus.trim().toLowerCase());
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.headGroup}>
        <PageHeader title="Plan" action={<BrandMark />} />
        <Text style={styles.copy}>Pick a focus and your time. The plan only uses machines at {gyms.length > 1 ? 'your gym' : gym?.name || 'your gym'}.</Text>
      </View>

      {activePlan ? <Pressable accessibilityRole="button" accessibilityLabel={`Open today's ${activePlan.focus} plan`} onPress={() => setView('plan')} style={({ pressed }) => [styles.ready, pressed && styles.pressed]}>
        <View style={styles.flex}>
          <Text style={styles.readyLabel}>Today’s plan</Text>
          <Text style={styles.readyTitle}>{activePlan.focus}</Text>
          <Text style={styles.readyMeta}>{activePlan.exercises.length} exercises · {plannedSets(activePlan)} sets · {activePlan.durationMinutes} min</Text>
        </View>
        <View style={styles.readyGo}><Ionicons name="arrow-forward" size={20} color={colors.onLime} /></View>
      </Pressable> : null}

      {gyms.length > 1 ? <View style={styles.block}><Text style={styles.sectionLabel}>Gym</Text><View style={styles.chips}>{gyms.map((item) => <Chip key={item.id} label={item.name} selected={item.id === gymId} onPress={() => setGymId(item.id)} />)}</View></View> : null}

      <View style={styles.block}>
        <Text style={styles.sectionLabel}>What are you training?</Text>
        <View style={styles.tiles}>{FOCUS_OPTIONS.map((option) => {
          const selected = focus.trim().toLowerCase() === option.label.toLowerCase();
          return <Pressable key={option.label} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { void Haptics.selectionAsync().catch(() => undefined); setFocus(option.label); }} style={({ pressed }) => [styles.tile, selected && styles.tileOn, pressed && styles.pressed]}>
            <Ionicons name={option.icon} size={22} color={selected ? colors.lime : colors.muted} />
            <Text style={[styles.tileText, selected && styles.tileTextOn]}>{option.label}</Text>
          </Pressable>;
        })}</View>
        <Field label="Or describe it" placeholder="e.g. glutes and hamstrings" value={custom ? focus : ''} onChangeText={setFocus} maxLength={160} returnKeyType="done" />
      </View>

      <View style={styles.block}>
        <View style={styles.listHead}><Text style={styles.sectionLabel}>How long do you have?</Text><Text style={styles.progress}>{duration} min</Text></View>
        <View style={styles.segments} accessibilityRole="radiogroup">{TIME_OPTIONS.map((minutes) => {
          const selected = duration === minutes;
          return <Pressable key={minutes} accessibilityRole="radio" accessibilityLabel={`${minutes} minutes`} accessibilityState={{ selected }} onPress={() => { void Haptics.selectionAsync().catch(() => undefined); setDuration(minutes); }} style={[styles.segment, selected && styles.segmentOn]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{minutes}</Text>
          </Pressable>;
        })}</View>
        <Text style={styles.timeHint}>Shorter plans cover the biggest priorities with fewer sets.</Text>
      </View>

      <Button label={activePlan ? 'Build a new plan' : 'Build my workout'} onPress={generate} loading={busy} disabled={!gymId || focus.trim().length < 2} />
      {busy ? <Text style={styles.status} accessibilityLiveRegion="polite">Matching exercises to your gym…</Text> : null}
      {message ? <Notice tone="danger">{message}</Notice> : null}
      <Text style={styles.disclaimer}>Planning is general fitness guidance, not a medical or injury-rehabilitation program. Stop if an exercise causes pain.</Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, screen: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, paddingBottom: 48, gap: 22 },
  headGroup: { gap: 6 },
  copy: { color: colors.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  block: { gap: 12 },
  sectionLabel: { color: colors.cream, fontFamily: fonts.semibold, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ready: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 20, padding: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.lime },
  readyLabel: { color: colors.lime, fontFamily: fonts.semibold, fontSize: 13 },
  readyTitle: { color: colors.cream, fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.4, marginTop: 2 },
  readyMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 4 },
  readyGo: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, minHeight: 84, borderRadius: 16, padding: 14, gap: 10, justifyContent: 'space-between', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  tileOn: { borderColor: colors.lime, backgroundColor: 'rgba(205,245,100,0.10)' },
  tileText: { color: colors.cream, fontFamily: fonts.semibold, fontSize: 15 }, tileTextOn: { color: colors.lime },
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.lime },
  segmentText: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 16 }, segmentTextOn: { color: colors.onLime },
  timeHint: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  status: { color: colors.lime, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center' },
  planHead: { gap: 4 },
  planMeta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14 },
  planTitle: { color: colors.cream, fontFamily: fonts.bold, fontSize: 34, letterSpacing: -1, lineHeight: 38 },
  stats: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingVertical: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  stat: { flex: 1, alignItems: 'center', gap: 4 }, statDivider: { width: 1, height: 34, backgroundColor: colors.border },
  statValue: { color: colors.lime, fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.5 },
  statLabel: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  areaList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: -6 },
  areaTag: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: colors.panel },
  areaTagText: { color: colors.cream, fontFamily: fonts.medium, fontSize: 12 },
  deferred: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  progress: { color: colors.lime, fontFamily: fonts.semibold, fontSize: 14 },
  exerciseList: { borderRadius: 20, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, marginTop: -8 },
  exercise: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 76, paddingVertical: 14 },
  exerciseRule: { borderTopWidth: 1, borderTopColor: colors.border },
  index: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  indexDone: { backgroundColor: colors.lime },
  indexText: { color: colors.lime, fontFamily: fonts.bold, fontSize: 14 },
  exerciseBody: { flex: 1, gap: 3 }, exerciseName: { color: colors.cream, fontFamily: fonts.semibold, fontSize: 16 }, exerciseMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13 },
  station: { alignItems: 'center', minWidth: 52, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 12, backgroundColor: colors.panelRaised },
  stationLabel: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11 }, stationCode: { color: colors.cream, fontFamily: fonts.bold, fontSize: 16 },
  logged: { color: colors.lime, fontFamily: fonts.medium, fontSize: 12 },
  pacing: { backgroundColor: colors.panel, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border }, pacingTitle: { color: colors.cream, fontFamily: fonts.semibold, fontSize: 15 }, pacingCopy: { color: colors.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.75 },
  disclaimer: { color: colors.dim, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }
});
