import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl,
  ScrollView, Share, StyleSheet, Text, View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Button, Card, Chip, Field, Notice, SectionTitle } from '../ui';
import { colors, fonts } from '../theme';
import { supabase } from '../supabase';
import { scanUrlFromTag } from '../nfc';
import { deleteMemberAccount, exportMemberData, loadHistory, loadPartnerGyms, machineLinkFromUrl, recordSet, recordTap, resolveMachine } from './api';
import { saveWorkoutToCloud, workoutMinutes } from './workouts';
import { GymMap, distanceMiles, formatMiles, type Coords } from './GymMap';
import { MuscleMap } from './MuscleMap';
import {
  appendWorkoutSet, discardActiveWorkout, ensureActiveWorkout, finishActiveWorkout, loadActiveWorkout, loadFinishedWorkouts, loadPendingWorkoutSets, loadPreferences,
  loadRecentMachines, markWorkoutCloudSynced, updateFinishedWorkout, markWorkoutSetSynced, newId, rememberMachine, replaceWorkoutSet, savePreferences
} from './storage';
import { isHealthKitSupported, readWorkoutHealthStats, requestHealthKitAccess, saveWorkoutToHealth } from './health';
import { connectStrava, disconnectStrava, isStravaConfigured, loadStravaConnection, uploadWorkoutToStrava } from './strava';
import { WorkoutTimerBar, useElapsed } from './WorkoutTimer';
import type { EquipmentSummary, MachineHistoryItem, MemberMachine, MemberPreferences, PartnerGym, WorkoutSession, WorkoutSet } from './types';
import { VAULT_EQUIPMENT, VAULT_GYM } from './vaultCatalog';

type MemberTab = 'today' | 'scan' | 'gyms' | 'profile';
type MachineLink = { publicId: string; exerciseSlug?: string };

export function MemberApp({ session, initialLink, onSwitchOwner }: { session: Session | null; initialLink?: MachineLink | null; onSwitchOwner: () => void }) {
  const [tab, setTab] = useState<MemberTab>('today');
  const [machineLink, setMachineLink] = useState<MachineLink | null>(initialLink || null);
  const [activeWorkout, setActiveWorkout] = useState<WorkoutSession | null>(null);
  const [finished, setFinished] = useState<WorkoutSession[]>([]);
  const [recent, setRecent] = useState<MemberMachine[]>([]);
  const [preferences, setPreferences] = useState<MemberPreferences>({ favoriteGymIds: [VAULT_GYM.id], weightUnit: 'lb' });
  const [gyms, setGyms] = useState<PartnerGym[]>([VAULT_GYM]);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const pending = await loadPendingWorkoutSets();
    const sessionId = session?.user.id || 'local-guest';
    await Promise.all(pending.map(async (set) => {
      try { await recordSet(set, sessionId, session); await markWorkoutSetSynced(set.clientLogId); }
      catch { /* Leave the set queued for the next refresh or app launch. */ }
    }));
    const [workout, history, machines, prefs, partnerGyms] = await Promise.all([
      loadActiveWorkout(), loadFinishedWorkouts(), loadRecentMachines(), loadPreferences(), loadPartnerGyms()
    ]);
    // Retry finished workouts that were saved on the phone while offline or signed out.
    if (session) await Promise.all(history.filter((item) => !item.cloudSynced).slice(0, 10).map(async (item) => {
      try { await saveWorkoutToCloud(session, item); await markWorkoutCloudSynced(item.id); item.cloudSynced = true; }
      catch { /* Leave it for the next refresh. */ }
    }));
    setActiveWorkout(workout); setFinished(history); setRecent(machines); setPreferences(prefs); setGyms(partnerGyms);
  }, [session?.access_token, session?.user.id]);

  useEffect(() => { reload(); }, [reload]);
  // Guests need a Supabase session (anonymous sign-in) for cloud workout history and Strava.
  useEffect(() => { if (!session) supabase.auth.signInAnonymously().catch(() => undefined); }, [session?.user.id]);
  useEffect(() => { if (initialLink) setMachineLink(initialLink); }, [initialLink?.publicId, initialLink?.exerciseSlug]);

  const refresh = async () => { setRefreshing(true); await reload(); setRefreshing(false); };
  const openMachine = (publicId: string, exerciseSlug?: string) => setMachineLink({ publicId, exerciseSlug });

  const completeWorkout = async () => {
    const result = await finishActiveWorkout();
    if (!result) return reload();
    // Pull heart rate and active calories Apple Health recorded between the first tap and Finish.
    if (preferences.healthKitEnabled) {
      const health = await readWorkoutHealthStats(result).catch(() => null);
      if (health) { result.health = health; await updateFinishedWorkout(result.id, { health }); }
    }
    const exports: string[] = [session ? 'Saved on this phone. It will sync to your account when you’re back online.' : 'Saved on this phone.'];
    try { if (await saveWorkoutToCloud(session, result)) { await markWorkoutCloudSynced(result.id); exports[0] = 'Saved to your workout history.'; } }
    catch { /* Kept locally; reload() retries. */ }
    if (preferences.healthKitEnabled) {
      try {
        const saved = await saveWorkoutToHealth(result);
        if (saved === 'matched') exports.push('Linked to your Apple Watch workout.');
        else if (saved === 'saved') exports.push('Saved to Apple Health.');
      }
      catch { exports.push('Apple Health could not save this workout.'); }
    }
    try { if (await uploadWorkoutToStrava(session, result)) exports.push('Uploaded to Strava.'); }
    catch (reason) { exports.push(reason instanceof Error ? reason.message : 'Strava upload failed.'); }
    Alert.alert('Workout complete', [workoutSummary(result), healthSummary(result.health), ...exports].filter(Boolean).join('\n'));
    await reload();
  };
  const finishWorkout = () => {
    if (!activeWorkout) return;
    if (!activeWorkout.sets.length) return Alert.alert('End workout?', 'No sets were logged, so nothing will be saved.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'End workout', style: 'destructive', onPress: async () => { await discardActiveWorkout(); await reload(); } }
    ]);
    Alert.alert('Finish workout?', `${activeWorkout.sets.length} ${activeWorkout.sets.length === 1 ? 'set' : 'sets'} will be saved to your history.`, [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Finish', onPress: completeWorkout }
    ]);
  };

  if (machineLink) return (
    <MachineScreen
      link={machineLink}
      session={session}
      workout={activeWorkout}
      preferences={preferences}
      onBack={() => setMachineLink(null)}
      onExercise={(exerciseSlug) => setMachineLink({ ...machineLink, exerciseSlug })}
      onWorkoutChanged={reload}
    />
  );

  const screen = tab === 'today'
    ? <TodayScreen workout={activeWorkout} finished={finished} recent={recent} onOpen={openMachine} onFinish={finishWorkout} refreshing={refreshing} onRefresh={refresh} />
    : tab === 'scan'
      ? <ScanScreen onOpen={openMachine} />
      : tab === 'gyms'
        ? <GymsScreen gyms={gyms} preferences={preferences} onPreferences={async (next) => { setPreferences(next); await savePreferences(next); }} onOpen={openMachine} />
        : <ProfileScreen session={session} preferences={preferences} onPreferences={async (next) => { setPreferences(next); await savePreferences(next); }} onSwitchOwner={onSwitchOwner} />;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      {activeWorkout && tab !== 'today' ? <View style={styles.timerDock}><WorkoutTimerBar startedAt={activeWorkout.startedAt} gymName={activeWorkout.gymName} setCount={activeWorkout.sets.length} onPress={() => setTab('today')} /></View> : null}
      <View style={styles.app}>{screen}</View>
      <MemberTabBar tab={tab} setTab={setTab} />
    </SafeAreaView>
  );
}

function TodayScreen({ workout, finished, recent, onOpen, onFinish, refreshing, onRefresh }: {
  workout: WorkoutSession | null; finished: WorkoutSession[]; recent: MemberMachine[]; onOpen: (id: string, exercise?: string) => void;
  onFinish: () => void; refreshing: boolean; onRefresh: () => void;
}) {
  const volume = workout?.sets.reduce((sum, set) => sum + set.weight * set.reps, 0) || 0;
  const exerciseCount = new Set(workout?.sets.map((set) => `${set.publicId}:${set.exerciseSlug || ''}`)).size;
  const elapsed = useElapsed(workout?.startedAt);
  return (
    <ScrollView contentContainerStyle={styles.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.lime} />}>
      <PageHeader title="Today" action={<BrandMark />} />
      {workout ? (
        <View style={styles.workoutPanel}>
          <View style={styles.workoutTop}><View><Text style={styles.workoutTitle}>Workout in progress</Text><Text style={styles.bodyMuted}>{workout.gymName}</Text></View><View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveLabel}>ACTIVE</Text></View></View>
          <View accessibilityLabel={`Elapsed time ${elapsed}`}><Text style={styles.workoutClock}>{elapsed}</Text><Text style={styles.metricLabel}>elapsed since your first tap</Text></View>
          <View style={styles.workoutMetrics}><Metric value={workout.sets.length} label="sets" /><Metric value={exerciseCount} label="exercises" /><Metric value={Math.round(volume).toLocaleString()} label="lb volume" /></View>
          {workout.sets.length ? <View style={styles.compactSets}>{workout.sets.slice(-3).reverse().map((set) => <View key={set.clientLogId} style={styles.compactSet}><View><Text style={styles.rowTitle}>{set.exerciseName || set.machineName}</Text><Text style={styles.rowMeta}>{set.weight} lb × {set.reps}{set.seatSetting ? ` · setting ${set.seatSetting}` : ''}</Text></View><SyncBadge state={set.syncState} /></View>)}</View> : <Text style={styles.bodyMuted}>Log a set on any machine and it will appear here.</Text>}
          <Button label={workout.sets.length ? 'Finish workout' : 'End workout'} onPress={onFinish} tone={workout.sets.length ? 'lime' : 'secondary'} />
        </View>
      ) : (
        <View style={styles.emptyHero}>
          <View style={styles.emptyIcon}><Ionicons name="flash" size={28} color={colors.black} /></View>
          <Text style={styles.heroTitle}>Your workout starts with a tap.</Text>
          <Text style={styles.bodyMuted}>Tap any StrictlyVision tag and your workout timer starts automatically.</Text>
        </View>
      )}

      <SectionTitle>Recent equipment</SectionTitle>
      {recent.length ? <View style={styles.list}>{recent.map((machine) => <EquipmentRow key={`${machine.publicId}:${machine.exerciseSlug || ''}`} machine={machine} onPress={() => onOpen(machine.publicId, machine.exerciseSlug || undefined)} />)}</View> : <EmptyRow icon="scan-outline" title="No equipment yet" copy="Your recently scanned machines will stay one tap away." />}

      <SectionTitle>Previous workouts</SectionTitle>
      {finished.length ? <View style={styles.list}>{finished.slice(0, 5).map((item) => <View key={item.id} style={styles.historyRow}><View><Text style={styles.rowTitle}>{new Date(item.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</Text><Text style={styles.rowMeta}>{item.gymName} · {workoutMinutes(item)} min · {plural(item.sets.length, 'set')}{item.health?.avgHeartRate ? ` · ♥ ${item.health.avgHeartRate} bpm` : ''}{item.health?.activeCalories ? ` · ${item.health.activeCalories} kcal` : ''}</Text></View><Text style={styles.historyVolume}>{Math.round(item.sets.reduce((sum, set) => sum + set.weight * set.reps, 0)).toLocaleString()} lb</Text></View>)}</View> : <EmptyRow icon="time-outline" title="No completed workouts" copy="Finish a workout and its summary will live here." />}
    </ScrollView>
  );
}

function ScanScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const scan = async () => {
    setBusy(true); setMessage('');
    try {
      const url = await scanUrlFromTag();
      const link = machineLinkFromUrl(url);
      if (!link) throw new Error('That tag is not linked to a StrictlyVision station.');
      onOpen(link.publicId);
    } catch (reason) { setMessage(nfcError(reason)); }
    setBusy(false);
  };
  const manual = () => {
    const value = code.trim().toLowerCase();
    const matched = VAULT_EQUIPMENT.find((item) => item.stationCode.toLowerCase() === value || item.publicId === value);
    if (!matched) return setMessage('Station not found. Try the label code or the machine name printed near the tag.');
    onOpen(matched.publicId);
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <PageHeader title="Scan" action={<BrandMark />} />
        <View style={styles.scanStage}>
          <View style={styles.scanRings}><View style={styles.scanRingsInner}><Ionicons name="phone-portrait-outline" size={44} color={colors.lime} /></View></View>
          <Text style={styles.scanTitle}>Tap the equipment tag</Text>
          <Text style={styles.centerCopy}>Hold the top of your phone close to the NFC sticker until StrictlyVision opens the machine.</Text>
          <Button label={busy ? 'Scanning…' : 'Start NFC scan'} onPress={scan} loading={busy} />
        </View>
        {message ? <Notice tone="danger">{message}</Notice> : null}
        <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR USE THE LABEL</Text><View style={styles.dividerLine} /></View>
        <Card style={styles.formCard}>
          <Field label="Station code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="Example: 14 or 16B" returnKeyType="go" onSubmitEditing={manual} />
          <Button label="Open station" onPress={manual} tone="secondary" disabled={!code.trim()} />
        </Card>
        <Notice>{Platform.OS === 'ios' ? 'On iPad or a device without NFC, use the station code printed on the equipment label.' : 'If NFC is unavailable or turned off, use the station code printed on the equipment label.'}</Notice>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function GymsScreen({ gyms, preferences, onPreferences, onOpen }: { gyms: PartnerGym[]; preferences: MemberPreferences; onPreferences: (prefs: MemberPreferences) => void; onOpen: (id: string) => void }) {
  const [showEquipment, setShowEquipment] = useState(false);
  const [query, setQuery] = useState('');
  const [userLocation, setUserLocation] = useState<Coords | null>(null);
  const sortedGyms = gyms
    .map((gym) => ({ gym, miles: userLocation ? distanceMiles(userLocation, gym) : null }))
    .sort((a, b) => (a.miles ?? 0) - (b.miles ?? 0));
  const visible = VAULT_EQUIPMENT.filter((item) => `${item.name} ${item.stationCode} ${item.category}`.toLowerCase().includes(query.toLowerCase()));
  const toggleGym = (id: string) => {
    const selected = preferences.favoriteGymIds.includes(id);
    onPreferences({ ...preferences, favoriteGymIds: selected ? preferences.favoriteGymIds.filter((item) => item !== id) : [...preferences.favoriteGymIds, id] });
  };
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <PageHeader title="Partner gyms" action={<BrandMark />} />
      <GymMap gyms={gyms} userLocation={userLocation} onUserLocation={setUserLocation} onSelectGym={() => setShowEquipment(true)} />
      {sortedGyms.map(({ gym, miles }) => {
        const selected = preferences.favoriteGymIds.includes(gym.id);
        return <View key={gym.id} style={[styles.gymPanel, { backgroundColor: gym.backgroundColor, borderColor: `${gym.accentColor}55` }]}>
          <View style={styles.gymHead}><View style={[styles.gymLogo, { borderColor: gym.accentColor }]}><Text style={[styles.gymLogoText, { color: gym.accentColor }]}>V</Text></View><View style={styles.flex}><Text style={styles.gymTitle}>{gym.name}</Text><Text style={styles.gymAddress}>{gym.address} · {gym.city}, {gym.region}</Text></View><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${gym.name} as a preferred gym`} onPress={() => toggleGym(gym.id)} style={[styles.favorite, selected && { backgroundColor: gym.accentColor }]}><Ionicons name={selected ? 'checkmark' : 'add'} size={20} color={selected ? gym.backgroundColor : gym.accentColor} /></Pressable></View>
          <View style={styles.gymStats}><Text style={styles.gymStat}>{gym.equipmentCount} connected stations</Text><Text style={styles.gymStat}>Open 24/7</Text>{miles !== null ? <Text style={styles.gymStat}>{formatMiles(miles)} away</Text> : null}</View>
          <View style={styles.gymActions}><Pressable onPress={() => setShowEquipment((value) => !value)} style={styles.gymAction}><Text style={[styles.gymActionText, { color: gym.accentColor }]}>{showEquipment ? 'Hide equipment' : 'View equipment'}</Text><Ionicons name={showEquipment ? 'chevron-up' : 'chevron-down'} size={17} color={gym.accentColor} /></Pressable><Pressable onPress={() => Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(gym.name)}&ll=${gym.latitude},${gym.longitude}`)} style={styles.gymAction}><Text style={[styles.gymActionText, { color: gym.accentColor }]}>Directions</Text><Ionicons name="navigate-outline" size={17} color={gym.accentColor} /></Pressable></View>
        </View>;
      })}
      {showEquipment ? <View style={styles.equipmentSection}><Field label="Find equipment" value={query} onChangeText={setQuery} placeholder="Machine, category, or station" /><Text style={styles.equipmentCount}>{visible.length} of 41 stations</Text><View style={styles.list}>{visible.map((item) => <Pressable key={item.publicId} onPress={() => onOpen(item.publicId)} style={styles.catalogRow}><View style={styles.stationCode}><Text style={styles.stationCodeText}>{item.stationCode}</Text></View><View style={styles.flex}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowMeta}>{item.category}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.muted} /></Pressable>)}</View></View> : null}
    </ScrollView>
  );
}

function ProfileScreen({ session, preferences, onPreferences, onSwitchOwner }: { session: Session | null; preferences: MemberPreferences; onPreferences: (prefs: MemberPreferences) => void; onSwitchOwner: () => void }) {
  const anonymous = !session || session.user.is_anonymous;
  const [accountBusy, setAccountBusy] = useState(false);
  const [strava, setStrava] = useState<{ connected: boolean; name?: string | null }>({ connected: false });
  const [connecting, setConnecting] = useState(false);
  useEffect(() => { loadStravaConnection().then((tokens) => setStrava({ connected: !!tokens, name: tokens?.athleteName })); }, []);
  const toggleHealth = async () => {
    if (preferences.healthKitEnabled) return onPreferences({ ...preferences, healthKitEnabled: false });
    try { await requestHealthKitAccess(); onPreferences({ ...preferences, healthKitEnabled: true }); }
    catch (reason) { Alert.alert('Apple Health unavailable', reason instanceof Error ? reason.message : 'Please try again.'); }
  };
  const toggleStrava = async () => {
    if (strava.connected) {
      return Alert.alert('Disconnect Strava?', 'Future workouts will stop uploading to Strava.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: async () => { await disconnectStrava(); setStrava({ connected: false }); } }
      ]);
    }
    setConnecting(true);
    try { const tokens = await connectStrava(session); setStrava({ connected: true, name: tokens.athleteName }); }
    catch (reason) { Alert.alert('Strava not connected', reason instanceof Error ? reason.message : 'Please try again.'); }
    setConnecting(false);
  };
  const exportData = async () => {
    if (!session) return;
    setAccountBusy(true);
    try {
      const result = await exportMemberData(session);
      if (result.downloadUrl) await Linking.openURL(result.downloadUrl);
      else if (result.data) await Share.share({ title: 'StrictlyVision data export', message: JSON.stringify(result.data, null, 2) });
      else Alert.alert('Export unavailable', 'Your export did not contain any data.');
    } catch (reason) { Alert.alert('Export unavailable', reason instanceof Error ? reason.message : 'Please try again.'); }
    setAccountBusy(false);
  };
  const deleteAccount = () => Alert.alert('Delete your account?', 'This permanently removes your StrictlyVision profile and workout history. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete account', style: 'destructive', onPress: async () => {
      if (!session) return;
      setAccountBusy(true);
      try {
        await deleteMemberAccount(session);
        await supabase.auth.signOut();
        Alert.alert('Account deleted', 'Your StrictlyVision account and cloud workout history were removed.');
      } catch (reason) { Alert.alert('Could not delete account', reason instanceof Error ? reason.message : 'Please try again.'); }
      setAccountBusy(false);
    } }
  ]);
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <PageHeader title="Profile" action={<BrandMark />} />
      <View style={styles.profileIdentity}><View style={styles.avatar}><Ionicons name={anonymous ? 'person-outline' : 'person'} size={26} color={colors.lime} /></View><View style={styles.flex}><Text style={styles.profileName}>{anonymous ? 'Guest athlete' : session.user.email || 'StrictlyVision member'}</Text><Text style={styles.bodyMuted}>{anonymous ? 'Your workout stays on this device until you create an account.' : 'Your progress syncs across your devices.'}</Text></View></View>
      {anonymous ? <MemberAuthCard /> : null}
      <SectionTitle>Training preferences</SectionTitle>
      <SettingRow icon="barbell-outline" title="Weight units" copy="Used throughout logs and progress"><View style={styles.segment}><Pressable onPress={() => onPreferences({ ...preferences, weightUnit: 'lb' })} style={[styles.segmentItem, preferences.weightUnit === 'lb' && styles.segmentActive]}><Text style={[styles.segmentText, preferences.weightUnit === 'lb' && styles.segmentTextActive]}>lb</Text></Pressable><Pressable onPress={() => onPreferences({ ...preferences, weightUnit: 'kg' })} style={[styles.segmentItem, preferences.weightUnit === 'kg' && styles.segmentActive]}><Text style={[styles.segmentText, preferences.weightUnit === 'kg' && styles.segmentTextActive]}>kg</Text></Pressable></View></SettingRow>
      <SettingRow icon="location-outline" title="Preferred gyms" copy={`${preferences.favoriteGymIds.length} selected`} />
      <SectionTitle>Connections</SectionTitle>
      {isHealthKitSupported() ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: !!preferences.healthKitEnabled }} onPress={toggleHealth}><SettingRow icon="heart-outline" title="Apple Health" copy={preferences.healthKitEnabled ? 'Heart rate and calories add to finished workouts' : 'Add heart rate and calories from Apple Watch'}><Text style={[styles.connectText, preferences.healthKitEnabled && styles.connectTextOn]}>{preferences.healthKitEnabled ? 'On' : 'Connect'}</Text></SettingRow></Pressable> : null}
      <Pressable accessibilityRole="button" onPress={toggleStrava} disabled={connecting || (!strava.connected && !isStravaConfigured())}><SettingRow icon="bicycle-outline" title="Strava" copy={strava.connected ? `Connected${strava.name ? ` as ${strava.name}` : ''} · workouts upload when you finish` : isStravaConfigured() ? 'Upload finished workouts as Weight Training' : 'Coming soon'}>{connecting ? <ActivityIndicator color={colors.lime} /> : <Text style={[styles.connectText, strava.connected && styles.connectTextOn]}>{strava.connected ? 'On' : isStravaConfigured() ? 'Connect' : ''}</Text>}</SettingRow></Pressable>
      <SectionTitle>App</SectionTitle>
      <Pressable onPress={onSwitchOwner}><SettingRow icon="business-outline" title="Switch to owner tools" copy="Approved gym accounts only" chevron /></Pressable>
      <Pressable onPress={() => Linking.openURL('https://strictlyinc.com/privacy')}><SettingRow icon="shield-checkmark-outline" title="Privacy" chevron /></Pressable>
      {!anonymous ? <Pressable onPress={exportData} disabled={accountBusy}><SettingRow icon="download-outline" title="Export my data" chevron /></Pressable> : null}
      {!anonymous ? <><Button label="Sign out" tone="secondary" onPress={() => supabase.auth.signOut()} disabled={accountBusy} /><Button label="Delete account" tone="danger" onPress={deleteAccount} disabled={accountBusy} /></> : null}
    </ScrollView>
  );
}

function MemberAuthCard() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const create = async () => {
    setBusy(true); setMessage('');
    if (password.length < 8) { setMessage('Use at least 8 characters for your password.'); setBusy(false); return; }
    const { error } = await supabase.auth.updateUser({ email: email.trim(), password }, { emailRedirectTo: ExpoLinking.createURL('auth/callback') });
    setMessage(error ? error.message : 'Check your email to confirm the account. Your guest progress will stay attached.'); setBusy(false);
  };
  const signIn = async () => {
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setMessage(error ? error.message : 'Signed in. Your local workout is ready to sync.'); setBusy(false);
  };
  const apple = async () => {
    setBusy(true); setMessage('');
    try {
      const rawNonce = newId();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL, AppleAuthentication.AppleAuthenticationScope.FULL_NAME], nonce: hashedNonce });
      if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');
      const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
      if (error) throw error;
    } catch (reason) { if ((reason as { code?: string }).code !== 'ERR_REQUEST_CANCELED') setMessage(reason instanceof Error ? reason.message : 'Apple sign-in did not finish.'); }
    setBusy(false);
  };
  const google = async () => {
    setBusy(true); setMessage('');
    try {
      const redirectTo = ExpoLinking.createURL('auth/callback');
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
      if (error || !data.url) throw error || new Error('Google sign-in could not start.');
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') throw new Error('Google sign-in was canceled.');
      const params = new URL(result.url.replace('#', '?')).searchParams;
      const code = params.get('code');
      const accessToken = params.get('access_token'); const refreshToken = params.get('refresh_token');
      const sessionError = code
        ? (await supabase.auth.exchangeCodeForSession(code)).error
        : accessToken && refreshToken
          ? (await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })).error
          : new Error(params.get('error_description') || 'Google sign-in did not return a session.');
      if (sessionError) throw sessionError;
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Google sign-in did not finish.'); }
    setBusy(false);
  };
  return <Card style={styles.authCard}><Text style={styles.authCardTitle}>Keep your progress</Text><Text style={styles.bodyMuted}>Create an account or sign in to use your history on another device.</Text>{Platform.OS === 'ios' ? <Button label="Continue with Apple" onPress={apple} tone="secondary" loading={busy} /> : null}<Button label="Continue with Google" onPress={google} tone="secondary" disabled={busy} /><View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>EMAIL</Text><View style={styles.dividerLine} /></View><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="you@example.com" /><Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="At least 8 characters" />{message ? <Notice tone={/check|signed in/i.test(message) ? 'success' : 'danger'}>{message}</Notice> : null}<Button label="Create account" onPress={create} loading={busy} disabled={!email.includes('@') || password.length < 8} /><Button label="Sign in to existing account" onPress={signIn} tone="secondary" disabled={busy || !email.includes('@') || !password} /></Card>;
}

function MachineScreen({ link, session, workout, preferences, onBack, onExercise, onWorkoutChanged }: { link: MachineLink; session: Session | null; workout: WorkoutSession | null; preferences: MemberPreferences; onBack: () => void; onExercise: (slug: string) => void; onWorkoutChanged: () => void }) {
  const [machine, setMachine] = useState<MemberMachine | null>(null); const [history, setHistory] = useState<MachineHistoryItem[]>([]); const [loading, setLoading] = useState(true); const [message, setMessage] = useState('');
  const [machineTab, setMachineTab] = useState<MachineTab>('log');
  const sessionId = session?.user.id || 'local-guest';
  const load = useCallback(async () => {
    setLoading(true); setMessage(''); setMachineTab('log');
    try {
      const resolved = await resolveMachine(link.publicId, link.exerciseSlug);
      setMachine(resolved); await rememberMachine(resolved); await recordTap(link.publicId, sessionId, session).catch(() => undefined);
      // The first tag tapped starts the workout clock; later taps join the same session.
      const active = await ensureActiveWorkout(gymIdFor(resolved.gymName), resolved.gymName);
      saveWorkoutToCloud(session, active).catch(() => undefined);
      onWorkoutChanged();
      if (resolved.stationType !== 'multi_exercise' || link.exerciseSlug) setHistory(await loadHistory(link.publicId, sessionId, session, link.exerciseSlug));
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'This station could not be opened.'); }
    setLoading(false);
  }, [link.publicId, link.exerciseSlug, session?.access_token]);
  useEffect(() => { load(); }, [load]);
  if (loading) return <SafeAreaView style={[styles.safe, styles.centered]}><ActivityIndicator color={colors.lime} size="large" /><Text style={styles.bodyMuted}>Opening station…</Text></SafeAreaView>;
  if (!machine) return <SafeAreaView style={[styles.safe, styles.screen]}><IconBack onPress={onBack} />{message ? <Notice tone="danger">{message}</Notice> : null}<Button label="Try again" onPress={load} /></SafeAreaView>;
  if (machine.stationType === 'multi_exercise' && !link.exerciseSlug) return <ExercisePicker machine={machine} onBack={onBack} onExercise={onExercise} />;
  const accent = machine.gymName === 'Vault Fitness Club' ? '#F2C44D' : colors.lime;
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}><ScrollView contentContainerStyle={styles.machineScreen} keyboardShouldPersistTaps="handled"><View style={styles.machineNav}><IconBack onPress={onBack} /><View style={[styles.gymChip, { borderColor: `${accent}88` }]}><View style={[styles.gymChipDot, { backgroundColor: accent }]} /><Text style={styles.gymChipText}>{machine.gymName}</Text></View></View>{workout ? <WorkoutTimerBar startedAt={workout.startedAt} gymName={workout.gymName} setCount={workout.sets.length} /> : null}<View><Text style={[styles.machineCategory, { color: accent }]}>{machine.category.toUpperCase()} · STATION {machine.stationCode}</Text><Text style={styles.machineTitle}>{machine.name}</Text>{machine.stationName ? <Text style={styles.bodyMuted}>{machine.stationName}</Text> : null}</View><MachineTabs tab={machineTab} onChange={setMachineTab} accent={accent} historyCount={history.length} />{machineTab === 'log' ? <SetLogger machine={machine} session={session} sessionId={sessionId} preferences={preferences} accent={accent} onSaved={async (item) => { setHistory((current) => [{ id: item.clientLogId, client_log_id: item.clientLogId, weight_lb: item.weight, reps: item.reps, seat_setting: item.seatSetting, notes: item.notes, occurred_at: item.createdAt }, ...current]); await onWorkoutChanged(); }} /> : machineTab === 'progress' ? <HistoryList history={history} unit={preferences.weightUnit} accent={accent} /> : <View style={styles.howTo}><MachineVideo url={machine.videoUrl} gymName={machine.gymName} accent={accent} /><View><SectionTitle>Steps</SectionTitle><View style={styles.instructions}>{machine.instructions.map((instruction, index) => <View key={`${instruction}-${index}`} style={styles.instruction}><View style={[styles.stepNumber, { backgroundColor: accent }]}><Text style={styles.stepNumberText}>{index + 1}</Text></View><Text style={styles.instructionText}>{instruction}</Text></View>)}</View></View><View><SectionTitle>Muscles worked</SectionTitle><MuscleMap primary={machine.primaryMuscles} assisting={machine.assistingMuscles} accent={accent} /><View style={styles.muscleCopy}><Text style={styles.rowMeta}>PRIMARY</Text><Text style={styles.rowTitle}>{machine.primaryMuscles.join(' · ')}</Text><Text style={[styles.rowMeta, { marginTop: 10 }]}>ASSISTS</Text><Text style={styles.rowTitle}>{machine.assistingMuscles.join(' · ') || '—'}</Text></View></View></View>}</ScrollView></SafeAreaView>;
}

function ExercisePicker({ machine, onBack, onExercise }: { machine: MemberMachine; onBack: () => void; onExercise: (slug: string) => void }) {
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}><ScrollView contentContainerStyle={styles.machineScreen}><IconBack onPress={onBack} /><Text style={styles.machineCategory}>{machine.gymName.toUpperCase()} · STATION {machine.stationCode}</Text><Text style={styles.machineTitle}>{machine.name}</Text><Text style={styles.bodyMuted}>Choose the movement you’re performing. Your history stays separate for every exercise.</Text><View style={styles.exerciseGrid}>{machine.exercises?.map((exercise) => <Pressable key={exercise.slug} onPress={() => onExercise(exercise.slug)} style={styles.exerciseChoice}><View style={styles.exerciseIcon}><Ionicons name="barbell-outline" size={22} color={colors.lime} /></View><View style={styles.flex}><Text style={styles.rowTitle}>{exercise.name}</Text><Text style={styles.rowMeta}>{exercise.category}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.muted} /></Pressable>)}</View></ScrollView></SafeAreaView>;
}

function SetLogger({ machine, session, sessionId, preferences, accent, onSaved }: { machine: MemberMachine; session: Session | null; sessionId: string; preferences: MemberPreferences; accent: string; onSaved: (set: WorkoutSet) => void }) {
  const [weight, setWeight] = useState(''); const [reps, setReps] = useState(''); const [seat, setSeat] = useState(''); const [notes, setNotes] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const save = async () => {
    const entered = Number(weight); const repCount = Number(reps);
    if (!Number.isFinite(entered) || entered < 0 || !Number.isInteger(repCount) || repCount < 1 || repCount > 100) return setMessage('Enter a valid weight and 1–100 reps.');
    const pounds = preferences.weightUnit === 'kg' ? entered * 2.2046226218 : entered;
    const item: WorkoutSet = { clientLogId: newId(), publicId: machine.publicId, machineName: machine.stationName || machine.name, exerciseSlug: machine.exerciseSlug, exerciseName: machine.name, gymName: machine.gymName, weight: Number(pounds.toFixed(2)), reps: repCount, seatSetting: seat.trim() || null, notes: notes.trim() || null, createdAt: new Date().toISOString(), syncState: 'pending' };
    setBusy(true); setMessage('');
    const gymId = gymIdFor(machine.gymName);
    const workout = await ensureActiveWorkout(gymId, machine.gymName);
    item.workoutSessionId = workout.id;
    await appendWorkoutSet(gymId, machine.gymName, item);
    try { await recordSet(item, sessionId, session); item.syncState = 'synced'; await replaceWorkoutSet(item.clientLogId, { syncState: 'synced' }); setMessage('Set saved.'); }
    catch { setMessage('Set saved offline. StrictlyVision will sync it when your connection returns.'); }
    setWeight(''); setReps(''); setSeat(''); setNotes(''); setBusy(false); onSaved(item);
  };
  return <View><Card style={styles.logger}><View style={styles.twoCol}><View style={styles.flex}><Field label={`Weight (${preferences.weightUnit})`} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="Enter weight" /></View><View style={styles.flex}><Field label="Reps" value={reps} onChangeText={setReps} keyboardType="number-pad" placeholder="Enter reps" /></View></View><Field label="Seat or machine setting · optional" value={seat} onChangeText={setSeat} autoCapitalize="characters" placeholder="Example: 4, B, or 3C" maxLength={12} /><Field label="Notes · optional" value={notes} onChangeText={setNotes} placeholder="Form cue, tempo, or how it felt" maxLength={160} />{message ? <Notice tone={/saved\.$/i.test(message) ? 'success' : 'normal'}>{message}</Notice> : null}<Pressable accessibilityRole="button" onPress={save} disabled={busy || !weight || !reps} style={({ pressed }) => [styles.accentButton, { backgroundColor: accent }, (!weight || !reps) && styles.disabled, pressed && styles.pressed]}>{busy ? <ActivityIndicator color={colors.black} /> : <Text style={styles.accentButtonText}>Record top set</Text>}</Pressable></Card></View>;
}

function HistoryList({ history, unit, accent }: { history: MachineHistoryItem[]; unit: 'lb' | 'kg'; accent: string }) {
  const [selected, setSelected] = useState<MachineHistoryItem | null>(history[0] || null);
  const convert = (pounds: number) => unit === 'kg' ? `${(pounds / 2.2046226218).toFixed(1)} kg` : `${Number(pounds).toFixed(pounds % 1 ? 1 : 0)} lb`;
  const best = history.reduce((max, item) => Math.max(max, Number(item.weight_lb) || 0), 0);
  const chart = history.slice(0, 8).reverse();
  return <View>{history.length ? <View style={styles.historyPanel}><View style={styles.progressTop}><View><Text style={styles.rowMeta}>HEAVIEST SET</Text><Text style={[styles.progressBest, { color: accent }]}>{convert(best)}</Text></View><Text style={styles.bodyMuted}>{plural(history.length, 'logged set')}</Text></View>{selected ? <View style={[styles.chartCallout, { borderColor: `${accent}88` }]}><View><Text style={styles.chartCalloutValue}>{convert(Number(selected.weight_lb))} × {selected.reps}</Text><Text style={styles.rowMeta}>{new Date(selected.occurred_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{selected.seat_setting ? ` · setting ${selected.seat_setting}` : ''}</Text></View><Text style={styles.chartCalloutVolume}>{Math.round(Number(selected.weight_lb) * selected.reps).toLocaleString()} lb volume</Text></View> : null}<View style={styles.historyBars}>{chart.map((item, index) => { const active = selected === item; return <Pressable accessibilityRole="button" accessibilityLabel={`${convert(Number(item.weight_lb))}, ${item.reps} reps, ${new Date(item.occurred_at).toLocaleDateString()}`} onPress={() => setSelected(item)} key={item.id || `${item.occurred_at}-${index}`} style={styles.historyBarColumn}><View style={[styles.historyBar, { height: Math.max(12, Number(item.weight_lb) / Math.max(best, 1) * 94), backgroundColor: accent, opacity: active ? 1 : .48 }, active && styles.historyBarSelected]} /><Text style={[styles.historyBarDate, active && { color: accent }]}>{new Date(item.occurred_at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</Text></Pressable>; })}</View><View style={styles.list}>{history.slice(0, 10).map((item, index) => <Pressable onPress={() => setSelected(item)} key={item.id || `${item.occurred_at}-${index}`} style={styles.historyRow}><View><Text style={styles.rowTitle}>{convert(Number(item.weight_lb))} × {item.reps}</Text><Text style={styles.rowMeta}>{new Date(item.occurred_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{item.seat_setting ? ` · setting ${item.seat_setting}` : ''}</Text></View><Text style={styles.historyVolume}>{Math.round(Number(item.weight_lb) * item.reps).toLocaleString()} lb</Text></Pressable>)}</View></View> : <EmptyRow icon="trending-up-outline" title="No history yet" copy="Your first set on this exercise will start the chart." />}</View>;
}

// Stock demo clips are hidden until each gym uploads its own video from the owner app.
const STOCK_VIDEO_HOSTS = ['musclewiki.com'];
function ownerVideoUrl(url?: string | null) {
  if (!url) return null;
  try { const host = new URL(url).hostname; return STOCK_VIDEO_HOSTS.some((stock) => host === stock || host.endsWith(`.${stock}`)) ? null : url; }
  catch { return null; }
}

function MachineVideo({ url, gymName, accent }: { url?: string | null; gymName: string; accent: string }) {
  const video = ownerVideoUrl(url);
  if (!video) return <View style={styles.videoMissing}><Ionicons name="videocam-outline" size={30} color={accent} /><Text style={styles.videoMissingTitle}>Video coming soon</Text><Text style={styles.centerCopy}>{gymName} hasn’t uploaded a demo for this machine yet. Follow the steps below until it’s ready.</Text></View>;
  return <PlayableVideo url={video} accent={accent} />;
}

type MachineTab = 'log' | 'progress' | 'howto';
function MachineTabs({ tab, onChange, accent, historyCount }: { tab: MachineTab; onChange: (tab: MachineTab) => void; accent: string; historyCount: number }) {
  const tabs: { id: MachineTab; label: string }[] = [
    { id: 'log', label: 'Record set' },
    { id: 'progress', label: historyCount ? `Progress · ${historyCount}` : 'Progress' },
    { id: 'howto', label: 'How to' }
  ];
  return <View accessibilityRole="tablist" style={styles.machineTabs}>{tabs.map((item) => { const active = tab === item.id; return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(item.id)} style={[styles.machineTab, active && { backgroundColor: accent }]}><Text numberOfLines={1} style={[styles.machineTabText, active && styles.machineTabTextActive]}>{item.label}</Text></Pressable>; })}</View>;
}

function PlayableVideo({ url, accent }: { url: string; accent: string }) {
  const player = useVideoPlayer(url, (instance) => { instance.loop = true; instance.muted = true; instance.play(); });
  return <View style={[styles.videoFrame, { borderColor: `${accent}66` }]}><VideoView player={player} style={styles.video} contentFit="contain" nativeControls /><View pointerEvents="none" style={styles.videoLabel}><View style={[styles.videoDot, { backgroundColor: accent }]} /><Text style={styles.videoLabelText}>FORM DEMONSTRATION</Text></View></View>;
}

function MemberTabBar({ tab, setTab }: { tab: MemberTab; setTab: (tab: MemberTab) => void }) {
  const tabs: { id: MemberTab; label: string; icon: keyof typeof Ionicons.glyphMap; active: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'today', label: 'Today', icon: 'flash-outline', active: 'flash' },
    { id: 'scan', label: 'Scan', icon: 'scan-outline', active: 'scan' },
    { id: 'gyms', label: 'Gyms', icon: 'business-outline', active: 'business' },
    { id: 'profile', label: 'Profile', icon: 'person-outline', active: 'person' }
  ];
  return <SafeAreaView edges={['bottom']} style={styles.tabSafe}><View style={styles.tabs}>{tabs.map((item) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} key={item.id} onPress={() => setTab(item.id)} style={styles.tab}><Ionicons name={tab === item.id ? item.active : item.icon} size={22} color={tab === item.id ? colors.lime : colors.muted} /><Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text></Pressable>)}</View></SafeAreaView>;
}

function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) { return <View style={styles.pageHeader}><Text style={styles.pageTitle}>{title}</Text>{action}</View>; }
function BrandMark() { return <View style={styles.brandMark}><Ionicons name="pulse" size={22} color={colors.lime} /></View>; }
function IconBack({ onPress }: { onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onPress} style={styles.backButton}><Ionicons name="chevron-back" size={24} color={colors.cream} /></Pressable>; }
function Metric({ value, label }: { value: string | number; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function SyncBadge({ state }: { state: WorkoutSet['syncState'] }) { return <View style={[styles.syncBadge, state === 'synced' && styles.syncBadgeSynced]}><Ionicons name={state === 'synced' ? 'checkmark' : 'cloud-offline-outline'} size={12} color={state === 'synced' ? colors.black : colors.cream} /><Text style={[styles.syncText, state === 'synced' && styles.syncTextSynced]}>{state === 'synced' ? 'Saved' : 'Pending'}</Text></View>; }
function EquipmentRow({ machine, onPress }: { machine: MemberMachine; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.equipmentRow}><View style={styles.equipmentGlyph}><Ionicons name="barbell-outline" size={21} color={colors.lime} /></View><View style={styles.flex}><Text style={styles.rowTitle}>{machine.name}</Text><Text style={styles.rowMeta}>{machine.gymName} · Station {machine.stationCode}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.muted} /></Pressable>; }
function EmptyRow({ icon, title, copy }: { icon: keyof typeof Ionicons.glyphMap; title: string; copy: string }) { return <View style={styles.emptyRow}><Ionicons name={icon} size={24} color={colors.muted} /><View style={styles.flex}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowMeta}>{copy}</Text></View></View>; }
function SettingRow({ icon, title, copy, children, chevron }: { icon: keyof typeof Ionicons.glyphMap; title: string; copy?: string; children?: React.ReactNode; chevron?: boolean }) { return <View style={styles.settingRow}><View style={styles.settingIcon}><Ionicons name={icon} size={20} color={colors.lime} /></View><View style={styles.flex}><Text style={styles.rowTitle}>{title}</Text>{copy ? <Text style={styles.rowMeta}>{copy}</Text> : null}</View>{children}{chevron ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}</View>; }
function workoutSummary(workout: WorkoutSession) { const duration = Math.max(1, Math.round((new Date(workout.finishedAt || Date.now()).getTime() - new Date(workout.startedAt).getTime()) / 60000)); const exercises = new Set(workout.sets.map((set) => set.exerciseName || set.machineName)).size; const volume = Math.round(workout.sets.reduce((sum, set) => sum + set.weight * set.reps, 0)); return `${duration} min · ${plural(exercises, 'exercise')} · ${plural(workout.sets.length, 'set')} · ${volume.toLocaleString()} lb volume`; }
function plural(count: number, word: string) { return `${count} ${word}${count === 1 ? '' : 's'}`; }
function healthSummary(health?: WorkoutSession['health']) {
  if (!health) return '';
  const parts = [
    health.avgHeartRate ? `avg ${health.avgHeartRate} bpm` : '',
    health.maxHeartRate ? `max ${health.maxHeartRate} bpm` : '',
    health.activeCalories ? `${health.activeCalories} active kcal` : ''
  ].filter(Boolean);
  return parts.length ? `♥ ${parts.join(' · ')}` : '';
}
function gymIdFor(gymName: string) { return gymName === VAULT_GYM.name ? VAULT_GYM.id : gymName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'strictly-demo-gym'; }
function nfcError(reason: unknown) { const message = reason instanceof Error ? reason.message : 'The scan did not finish.'; if (/cancel|invalidate/i.test(message)) return 'Scan canceled. You can try again or enter the station code.'; if (/support/i.test(message)) return 'NFC is not available on this device. Enter the station code instead.'; return message; }

const styles = StyleSheet.create({
  machineTabs: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  machineTab: { flex: 1, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  machineTabText: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14 }, machineTabTextActive: { color: colors.onLime },
  howTo: { gap: 28 },
  timerDock: { paddingHorizontal: 20, paddingTop: 8 }, workoutClock: { color: colors.lime, fontFamily: fonts.bold, fontSize: 56, lineHeight: 60, letterSpacing: -1.7, fontVariant: ['tabular-nums'] },
  connectText: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 }, connectTextOn: { color: colors.lime },
  safe: { flex: 1, backgroundColor: colors.forest }, app: { flex: 1 }, flex: { flex: 1 }, centered: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }, screen: { padding: 20, paddingBottom: 38, gap: 24 }, machineScreen: { padding: 20, paddingBottom: 52, gap: 28 },
  pageHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, pageTitle: { color: colors.cream, fontSize: 34, lineHeight: 40, fontFamily: fonts.bold, letterSpacing: -1.0 }, brandMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  bodyMuted: { fontFamily: fonts.regular, color: colors.muted, fontSize: 15, lineHeight: 22 }, centerCopy: { fontFamily: fonts.regular, color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' }, rowTitle: { color: colors.cream, fontSize: 16, lineHeight: 21, fontFamily: fonts.semibold }, rowMeta: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, lineHeight: 18 }, list: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  emptyHero: { minHeight: 250, borderRadius: 16, backgroundColor: colors.black, padding: 24, justifyContent: 'flex-end', gap: 14 }, emptyIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime }, heroTitle: { color: colors.cream, fontSize: 30, lineHeight: 34, fontFamily: fonts.bold, letterSpacing: -0.9, maxWidth: 310 },
  workoutPanel: { borderRadius: 16, backgroundColor: colors.black, padding: 20, gap: 18 }, workoutTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, workoutTitle: { color: colors.cream, fontSize: 20, fontFamily: fonts.bold }, liveBadge: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.panel }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.mint }, liveLabel: { color: colors.mint, fontSize: 10, fontFamily: fonts.bold, letterSpacing: 1 }, workoutMetrics: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 16 }, metric: { flex: 1, gap: 3 }, metricValue: { color: colors.cream, fontSize: 21, fontFamily: fonts.bold }, metricLabel: { fontFamily: fonts.regular, color: colors.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: .7 }, compactSets: { gap: 12 }, compactSet: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: colors.panelRaised, paddingHorizontal: 8, paddingVertical: 5 }, syncBadgeSynced: { backgroundColor: colors.mint }, syncText: { color: colors.cream, fontSize: 10, fontFamily: fonts.semibold }, syncTextSynced: { color: colors.black },
  equipmentRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, equipmentGlyph: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.panelRaised, alignItems: 'center', justifyContent: 'center' }, emptyRow: { minHeight: 82, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }, historyRow: { minHeight: 67, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, historyVolume: { color: colors.cream, fontSize: 13, fontFamily: fonts.semibold },
  scanStage: { minHeight: 350, backgroundColor: colors.black, borderRadius: 16, padding: 24, justifyContent: 'center', gap: 17 }, scanRings: { alignSelf: 'center', width: 146, height: 146, borderRadius: 73, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, scanRingsInner: { width: 100, height: 100, borderRadius: 50, borderWidth: 1, borderColor: colors.lime, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' }, scanTitle: { color: colors.cream, textAlign: 'center', fontSize: 26, fontFamily: fonts.bold , letterSpacing: -0.8 }, divider: { flexDirection: 'row', alignItems: 'center', gap: 12 }, dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }, dividerText: { color: colors.muted, fontSize: 10, fontFamily: fonts.bold, letterSpacing: 1.1 }, formCard: { gap: 16 },
  partnerMap: { height: 220, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, mapRoad: { position: 'absolute', height: 8, borderRadius: 8, backgroundColor: '#2A2E30', opacity: .5 }, mapRoadA: { width: 330, top: 85, left: -35, transform: [{ rotate: '-16deg' }] }, mapRoadB: { width: 280, top: 130, right: -40, transform: [{ rotate: '28deg' }] }, mapPin: { position: 'absolute', top: 72, left: '46%', width: 46, height: 46, borderRadius: 16, backgroundColor: '#F2C44D', borderWidth: 4, borderColor: '#090909', alignItems: 'center', justifyContent: 'center' }, mapCaption: { position: 'absolute', left: 16, bottom: 16, right: 16, borderRadius: 14, backgroundColor: '#08090AEE', padding: 13 }, mapCaptionTitle: { color: colors.cream, fontSize: 14, fontFamily: fonts.bold }, mapCaptionCopy: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, marginTop: 2 }, gymPanel: { borderRadius: 16, borderWidth: 1, padding: 18, gap: 16 }, gymHead: { flexDirection: 'row', alignItems: 'center', gap: 13 }, gymLogo: { width: 52, height: 52, borderRadius: 16, borderWidth: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }, gymLogoText: { fontSize: 24, fontFamily: fonts.bold , letterSpacing: -0.7 }, gymTitle: { color: '#F6F0E4', fontSize: 20, fontFamily: fonts.bold }, gymAddress: { fontFamily: fonts.regular, color: '#BFB8AA', fontSize: 12, marginTop: 3 }, favorite: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: '#F2C44D', alignItems: 'center', justifyContent: 'center' }, gymStats: { flexDirection: 'row', gap: 8 }, gymStat: { fontFamily: fonts.regular, color: '#D6CDAF', fontSize: 11, borderWidth: 1, borderColor: '#5C4A22', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 }, gymActions: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#5C4A22', paddingTop: 14 }, gymAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 }, gymActionText: { fontSize: 13, fontFamily: fonts.bold }, equipmentSection: { gap: 14 }, equipmentCount: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 }, catalogRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, stationCode: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.panelRaised, alignItems: 'center', justifyContent: 'center' }, stationCodeText: { color: colors.lime, fontSize: 12, fontFamily: fonts.bold },
  profileIdentity: { flexDirection: 'row', gap: 14, alignItems: 'center' }, avatar: { width: 58, height: 58, borderRadius: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, profileName: { color: colors.cream, fontSize: 19, fontFamily: fonts.bold }, authCard: { gap: 15 }, authCardTitle: { color: colors.cream, fontSize: 21, fontFamily: fonts.bold }, settingRow: { minHeight: 72, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14 }, settingIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.panelRaised, alignItems: 'center', justifyContent: 'center' }, segment: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: colors.black }, segmentItem: { minWidth: 46, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, segmentActive: { backgroundColor: colors.lime }, segmentText: { color: colors.muted, fontSize: 13, fontFamily: fonts.bold }, segmentTextActive: { color: colors.black },
  machineNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, backButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, gymChip: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12 }, gymChipDot: { width: 7, height: 7, borderRadius: 4 }, gymChipText: { color: colors.cream, fontSize: 11, fontFamily: fonts.semibold }, machineCategory: { color: colors.dim, fontSize: 11, lineHeight: 16, fontFamily: fonts.bold, letterSpacing: 1.2 }, machineTitle: { color: colors.cream, fontSize: 38, lineHeight: 42, fontFamily: fonts.bold, letterSpacing: -1.1, marginVertical: 5 }, videoFrame: { minHeight: 250, borderRadius: 16, overflow: 'hidden', backgroundColor: '#050607', borderWidth: 1 }, video: { width: '100%', aspectRatio: 16 / 9, minHeight: 250 }, videoLabel: { position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: '#08090AE8' }, videoDot: { width: 7, height: 7, borderRadius: 4 }, videoLabelText: { color: colors.cream, fontSize: 9, fontFamily: fonts.bold, letterSpacing: .8 }, videoMissing: { minHeight: 220, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 22, backgroundColor: colors.black, borderWidth: 1, borderColor: colors.border }, videoMissingTitle: { color: colors.cream, fontSize: 21, fontFamily: fonts.bold }, instructions: { gap: 12, marginTop: 14 }, instruction: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, stepNumber: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, stepNumberText: { color: colors.black, fontSize: 12, fontFamily: fonts.bold }, instructionText: { fontFamily: fonts.regular, flex: 1, color: colors.cream, fontSize: 15, lineHeight: 22 }, muscleCopy: { backgroundColor: colors.panel, borderRadius: 16, padding: 16, marginTop: 10 }, logger: { gap: 16 }, twoCol: { flexDirection: 'row', gap: 12 }, accentButton: { minHeight: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, accentButtonText: { color: colors.black, fontSize: 16, fontFamily: fonts.bold }, disabled: { opacity: .45 }, pressed: { opacity: .88, transform: [{ scale: .99 }] }, historyPanel: {backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden' }, progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', padding: 16 }, progressBest: { fontSize: 30, fontFamily: fonts.bold, marginTop: 3 , letterSpacing: -0.9 }, chartCallout: { marginHorizontal: 16, padding: 13, borderWidth: 1, borderRadius: 14, backgroundColor: colors.black, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, chartCalloutValue: { color: colors.cream, fontSize: 16, fontFamily: fonts.bold }, chartCalloutVolume: { fontFamily: fonts.regular, color: colors.muted, fontSize: 11, textAlign: 'right' }, historyBars: { height: 130, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingBottom: 12 }, historyBarColumn: { flex: 1, minHeight: 112, alignItems: 'center', justifyContent: 'flex-end', gap: 6 }, historyBar: { width: '76%', maxWidth: 28, borderRadius: 7 }, historyBarSelected: { borderWidth: 2, borderColor: colors.cream }, historyBarDate: { fontFamily: fonts.regular, color: colors.muted, fontSize: 8 }, exerciseGrid: { gap: 10 }, exerciseChoice: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, borderRadius: 16, padding: 14 }, exerciseIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.panelRaised, alignItems: 'center', justifyContent: 'center' },
  tabSafe: { backgroundColor: colors.black, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, tabs: { height: 66, flexDirection: 'row', paddingHorizontal: 8 }, tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 }, tabText: { color: colors.muted, fontSize: 10, fontFamily: fonts.semibold }, tabTextActive: { color: colors.cream }
});
