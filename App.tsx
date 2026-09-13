import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View, type ImageStyle
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import type { Session } from '@supabase/supabase-js';
import Svg, { Polygon } from 'react-native-svg';
import { assignTag, inviteOwner, loadDashboard, loadMachine, saveMachine, uploadMachineVideo } from './src/api';
import { draftFromCatalog, MACHINE_CATALOG, type CatalogMachine } from './src/catalog';
import { verifyUrlOnTag, writeUrlToTag } from './src/nfc';
import { supabase } from './src/supabase';
import { colors, fonts } from './src/theme';
import type { DashboardData, Machine, MachineDraft, MachineTag, OwnerRole, ProvisioningDraft } from './src/types';
import { Button, Card, Chip, Eyebrow, Field, Notice, SectionTitle } from './src/ui';
import { MemberApp } from './src/member/MemberApp';
import { machineLinkFromUrl } from './src/member/api';

type Tab = 'dashboard' | 'machines' | 'setup' | 'account';
type AppMode = 'member' | 'owner';
type MachineLink = { publicId: string; exerciseSlug?: string };
const MODE_KEY = 'strictlyvision.app-mode.v1';

const blankDraft = (): MachineDraft => ({ name: '', stationCode: '', category: '', status: 'active', primaryMuscles: [], assistingMuscles: [], instructions: [] });
const csv = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
const lines = (value: string) => value.split('\n').map((part) => part.trim()).filter(Boolean);
const makePublicId = (name: string, station: string) => {
  const slug = `${name}-${station}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'machine';
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [mode, setMode] = useState<AppMode | null>(null);
  const [initialLink, setInitialLink] = useState<MachineLink | null>(null);
  const [fontsLoaded, fontError] = useFonts({ SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold });

  useEffect(() => {
    Promise.all([supabase.auth.getSession(), AsyncStorage.getItem(MODE_KEY), Linking.getInitialURL()]).then(([auth, savedMode, url]) => {
      setSession(auth.data.session);
      if (url) {
        const link = machineLinkFromUrl(url);
        if (link) { setInitialLink(link); setMode('member'); }
        else if (savedMode === 'member' || savedMode === 'owner') setMode(savedMode);
      } else if (savedMode === 'member' || savedMode === 'owner') setMode(savedMode);
      setBooting(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      const link = machineLinkFromUrl(url);
      if (link) { setInitialLink(link); chooseMode('member'); }
    });
    return () => { data.subscription.unsubscribe(); linkSubscription.remove(); };
  }, []);

  const chooseMode = async (next: AppMode) => {
    setMode(next); await AsyncStorage.setItem(MODE_KEY, next);
    if (next === 'member' && !session) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) console.warn('Anonymous member session unavailable; continuing with local workout storage.', error.message);
    }
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {booting || (!fontsLoaded && !fontError) ? <Loading label="Opening StrictlyVision…" />
        : !mode ? <RoleChoiceScreen onMember={() => chooseMode('member')} onOwner={() => chooseMode('owner')} />
          : mode === 'member' ? <MemberApp session={session} initialLink={initialLink} onSwitchOwner={() => chooseMode('owner')} />
            : session && !session.user.is_anonymous ? <OwnerApp session={session} onSwitchMember={() => chooseMode('member')} />
              : <AuthScreen onBack={() => { setMode(null); AsyncStorage.removeItem(MODE_KEY); }} />}
    </SafeAreaProvider>
  );
}

function RoleChoiceScreen({ onMember, onOwner }: { onMember: () => void; onOwner: () => void }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.roleScreen}>
        <Image source={require('./assets/strictlyvision-mark-transparent.png')} style={styles.roleLogo as ImageStyle} resizeMode="contain" />
        <View style={styles.roleIntro}><Text style={styles.roleBrand}>STRICTLYVISION</Text><Text style={styles.roleTitle}>The gym floor,{`\n`}connected to you.</Text><Text style={styles.roleCopy}>Train with any connected machine or manage the system behind your gym.</Text></View>
        <View style={styles.roleActions}>
          <Pressable accessibilityRole="button" onPress={onMember} style={({ pressed }) => [styles.rolePrimary, pressed && styles.rolePressed]}><View style={styles.roleActionIcon}><Ionicons name="barbell" size={24} color={colors.black} /></View><View style={styles.flex}><Text style={styles.rolePrimaryTitle}>I’m training</Text><Text style={styles.rolePrimaryCopy}>Scan equipment, log sets, and keep your progress.</Text></View><Ionicons name="chevron-forward" size={24} color={colors.black} /></Pressable>
          <Pressable accessibilityRole="button" onPress={onOwner} style={({ pressed }) => [styles.roleSecondary, pressed && styles.rolePressed]}><View style={styles.roleOwnerIcon}><Ionicons name="business" size={22} color={colors.lime} /></View><View style={styles.flex}><Text style={styles.roleSecondaryTitle}>I manage a gym</Text><Text style={styles.roleSecondaryCopy}>Owner dashboard, equipment, analytics, and NFC setup.</Text></View><Ionicons name="chevron-forward" size={24} color={colors.cream} /></Pressable>
        </View>
        <Text style={styles.roleFine}>You can switch modes later. Owner tools remain invite-only.</Text>
      </View>
    </SafeAreaView>
  );
}

function OwnerApp({ session, onSwitchMember }: { session: Session; onSwitchMember: () => void }) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeGymId, setActiveGymId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const refresh = async (gymId = activeGymId, pull = false) => {
    pull ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const result = await loadDashboard(session, gymId);
      setData(result); setActiveGymId(result.gym.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your owner access could not be loaded.');
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { refresh(null); }, [session.access_token]);

  if (loading && !data) return <Loading label="Loading owner tools…" />;
  if (error && !data) return <AccessError error={error} onRetry={() => refresh(null)} />;
  if (!data) return null;

  const body = tab === 'dashboard'
    ? <DashboardScreen data={data} refreshing={refreshing} onRefresh={() => refresh(activeGymId, true)} onStartSetup={() => setTab('setup')} />
    : tab === 'machines'
      ? <MachinesScreen session={session} data={data} onChanged={() => refresh(activeGymId, true)} onProgram={() => setTab('setup')} />
      : tab === 'setup'
        ? <SetupScreen session={session} data={data} onChanged={() => refresh(activeGymId, true)} />
        : <AccountScreen session={session} data={data} onGymChange={(id) => { setActiveGymId(id); refresh(id); }} onSwitchMember={onSwitchMember} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.app}>{body}</View>
      <TabBar tab={tab} setTab={setTab} />
    </SafeAreaView>
  );
}

function AuthScreen({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const signIn = async () => {
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMessage(error.message);
    setBusy(false);
  };
  const reset = async () => {
    if (!email.trim()) return setMessage('Enter your email first.');
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: 'https://strictlyinc.com/owner?mode=reset' });
    setMessage(error ? error.message : 'Reset email sent. Open it on this phone to choose a new password.');
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.centered}>
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          <Pressable onPress={onBack} style={styles.authBack}><Text style={styles.backLink}>‹ Choose mode</Text></Pressable>
          <StrictlyMark />
          <Eyebrow>Strictly connected fitness</Eyebrow>
          <Text style={styles.authTitle}>Owner tools,{`\n`}in your pocket.</Text>
          <Text style={styles.authCopy}>Program tags, manage equipment, and understand how your floor is being used.</Text>
          <Card style={styles.authCard}>
            <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="owner@gym.com" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" placeholder="Your password" />
            {message ? <Notice tone={/sent/i.test(message) ? 'success' : 'danger'}>{message}</Notice> : null}
            <Button label="Sign in" onPress={signIn} loading={busy} disabled={!email.trim() || !password} />
            <Pressable onPress={reset}><Text style={styles.textLink}>Forgot password?</Text></Pressable>
          </Card>
          <Text style={styles.authFine}>Owner access is invite-only. Ask Strictly or your gym administrator to approve your account.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DashboardScreen({ data, refreshing, onRefresh, onStartSetup }: { data: DashboardData; refreshing: boolean; onRefresh: () => void; onStartSetup: () => void }) {
  const activity = data.dailyActivity.slice(-7);
  const max = Math.max(1, ...activity.map((day) => Number(day.taps)));
  const top = [...data.machines].sort((a, b) => Number(b.taps30Days) - Number(a.taps30Days)).slice(0, 3);
  return (
    <ScrollView contentContainerStyle={styles.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.lime} />}>
      <View style={styles.header}><View><Eyebrow>Live gym</Eyebrow><Text style={styles.pageTitle}>{data.gym.name}</Text></View><View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View></View>
      <Card style={styles.heroCard}>
        <Eyebrow>Today</Eyebrow>
        <Text style={styles.heroNumber}>{data.summary.tapsToday}</Text>
        <Text style={styles.heroLabel}>member taps across your floor</Text>
        <View style={styles.statRow}>
          <MiniStat value={data.summary.taps7Days} label="7 days" />
          <MiniStat value={data.summary.activeTagCount} label="active tags" />
          <MiniStat value={data.summary.machineCount} label="machines" />
        </View>
      </Card>
      <SectionTitle>Last 7 days</SectionTitle>
      <Card>
        <View style={styles.chart}>
          {activity.map((day) => {
            const height = Math.max(8, Number(day.taps) / max * 118);
            return <View key={day.date} style={styles.barColumn}><Text style={styles.barValue}>{day.taps}</Text><View style={[styles.bar, { height }]} /><Text style={styles.barLabel}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</Text></View>;
          })}
        </View>
      </Card>
      <SectionTitle>Floor pulse</SectionTitle>
      <Card style={styles.gap12}>
        {top.length ? top.map((machine, index) => <View key={machine.id} style={styles.rankRow}><Text style={styles.rank}>0{index + 1}</Text><View style={styles.flex}><Text style={styles.machineName}>{machine.name}</Text><Text style={styles.muted}>Station {machine.stationCode}</Text></View><Text style={styles.rankValue}>{machine.taps30Days}<Text style={styles.muted}> taps</Text></Text></View>) : <Text style={styles.muted}>Activity will appear after members begin tapping tags.</Text>}
      </Card>
      <Card style={styles.setupCallout}><View style={styles.flex}><Eyebrow>New equipment</Eyebrow><Text style={styles.calloutTitle}>Tag a machine in minutes.</Text><Text style={styles.muted}>Choose equipment, tap the sticker, verify it, and place it on the gym floor.</Text></View><Button label="Start setup" onPress={onStartSetup} /></Card>
    </ScrollView>
  );
}

function MachinesScreen({ session, data, onChanged, onProgram }: { session: Session; data: DashboardData; onChanged: () => void; onProgram: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Machine | null>(null);
  const [draft, setDraft] = useState<MachineDraft>(blankDraft());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const visible = data.machines.filter((machine) => `${machine.name} ${machine.stationCode} ${machine.category}`.toLowerCase().includes(query.toLowerCase()));

  const openMachine = async (summary: Machine) => {
    setBusy(true); setMessage('');
    try {
      const result = await loadMachine(session, data.gym.id, summary.id);
      setSelected(result.machine);
      setDraft({ machineId: result.machine.id, name: result.machine.name, stationCode: result.machine.stationCode, category: result.machine.category, status: result.machine.status, primaryMuscles: result.machine.primaryMuscles, assistingMuscles: result.machine.assistingMuscles, instructions: result.machine.instructions });
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Machine could not be opened.'); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true); setMessage('');
    try { await saveMachine(session, data.gym.id, draft); setMessage('Machine updated.'); await onChanged(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Machine could not be saved.'); }
    setBusy(false);
  };
  const upload = async () => {
    if (!selected) return;
    const result = await DocumentPicker.getDocumentAsync({ type: ['video/mp4', 'video/quicktime', 'video/webm'], copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    setBusy(true); setMessage('Uploading video…');
    try { await uploadMachineVideo(session, data.gym.id, selected.id, asset); setMessage('Demonstration video updated.'); await onChanged(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Video could not be uploaded.'); }
    setBusy(false);
  };

  if (selected) return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => { setSelected(null); setMessage(''); }}><Text style={styles.backLink}>‹ All machines</Text></Pressable>
      <Eyebrow>Station {selected.stationCode}</Eyebrow><Text style={styles.pageTitle}>Manage machine</Text>
      <Card style={styles.formCard}>
        <Field label="Machine name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
        <View style={styles.twoCol}><View style={styles.flex}><Field label="Station" value={draft.stationCode} onChangeText={(stationCode) => setDraft({ ...draft, stationCode })} /></View><View style={styles.flex}><Field label="Category" value={draft.category} onChangeText={(category) => setDraft({ ...draft, category })} /></View></View>
        <Field label="Primary muscles" value={draft.primaryMuscles.join(', ')} onChangeText={(value) => setDraft({ ...draft, primaryMuscles: csv(value) })} hint="Separate muscles with commas." />
        <Field label="Assisting muscles" value={draft.assistingMuscles.join(', ')} onChangeText={(value) => setDraft({ ...draft, assistingMuscles: csv(value) })} />
        <Field label="Instructions" multiline value={draft.instructions.join('\n')} onChangeText={(value) => setDraft({ ...draft, instructions: lines(value) })} hint="One concise instruction per line." />
        {message ? <Notice tone={/updated/i.test(message) ? 'success' : 'normal'}>{message}</Notice> : null}
        <Button label="Save machine" onPress={save} loading={busy} />
        <Button label={selected.videoUrl ? 'Replace demo video' : 'Upload demo video'} onPress={upload} tone="secondary" disabled={busy} />
      </Card>
      <SectionTitle>Installed tags</SectionTitle>
      <Card style={styles.gap12}>{selected.tags.length ? selected.tags.map((tag) => <View key={tag.publicId} style={styles.tagRow}><View><Text style={styles.machineName}>{tag.labelCode}</Text><Text style={styles.muted}>{tag.type.toUpperCase()} · {tag.status}</Text></View><Text style={styles.tagCheck}>{tag.status === 'active' ? '✓' : '—'}</Text></View>) : <Text style={styles.muted}>No NFC tag is assigned yet.</Text>}<Button label="Program or replace tag" onPress={onProgram} tone="secondary" /></Card>
    </ScrollView>
  );

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Eyebrow>Equipment catalog</Eyebrow><Text style={styles.pageTitle}>Machines</Text>
      <Field label="Search your floor" value={query} onChangeText={setQuery} placeholder="Name, station, or category" />
      {message ? <Notice tone="danger">{message}</Notice> : null}
      {busy ? <ActivityIndicator color={colors.lime} /> : visible.map((machine) => {
        const active = machine.tags.some((tag) => tag.status === 'active');
        return <Pressable key={machine.id} onPress={() => openMachine(machine)}><Card style={styles.machineCard}><View style={styles.machineCode}><Text style={styles.machineCodeText}>{machine.stationCode}</Text></View><View style={styles.flex}><Text style={styles.machineName}>{machine.name}</Text><Text style={styles.muted}>{machine.category} · {machine.taps30Days} taps / 30d</Text></View><View style={[styles.statusDot, active && styles.statusDotActive]} /></Card></Pressable>;
      })}
      <Button label="Add or program equipment" onPress={onProgram} />
    </ScrollView>
  );
}

function SetupScreen({ session, data, onChanged }: { session: Session; data: DashboardData; onChanged: () => void }) {
  const [stage, setStage] = useState<'choose' | 'details' | 'write' | 'verify' | 'success'>('choose');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<MachineDraft>(blankDraft());
  const [provisioning, setProvisioning] = useState<ProvisioningDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const catalog = MACHINE_CATALOG.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase()));

  const chooseCatalog = (item: CatalogMachine) => { setDraft(draftFromCatalog(item, String(data.summary.machineCount + 1).padStart(2, '0'))); setStage('details'); setMessage(''); };
  const chooseExisting = async (machine: Machine) => {
    setBusy(true); setMessage('');
    try {
      const result = await loadMachine(session, data.gym.id, machine.id);
      const full = result.machine;
      setDraft({ machineId: full.id, name: full.name, stationCode: full.stationCode, category: full.category, status: full.status, primaryMuscles: full.primaryMuscles, assistingMuscles: full.assistingMuscles, instructions: full.instructions });
      const tag = full.tags.find((item) => item.status === 'active') || full.tags[0];
      if (tag) setProvisioning({ machineId: full.id, machineName: full.name, publicId: tag.publicId, labelCode: tag.labelCode, tagType: tag.type, url: `https://strictlyinc.com/t/${tag.publicId}` });
      setStage('details');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Machine could not be loaded.'); }
    setBusy(false);
  };
  const prepare = async () => {
    setBusy(true); setMessage('');
    try {
      const saved = await saveMachine(session, data.gym.id, draft);
      const existing = provisioning?.machineId === saved.machineId ? provisioning : null;
      const publicId = existing?.publicId || makePublicId(draft.name, draft.stationCode);
      const labelCode = existing?.labelCode || `${draft.stationCode}-${draft.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase()}`;
      const next: ProvisioningDraft = { machineId: saved.machineId, machineName: draft.name, publicId, labelCode, tagType: 'ntag215', url: `https://strictlyinc.com/t/${publicId}` };
      await assignTag(session, data.gym.id, saved.machineId, { publicId, labelCode, type: 'ntag215', status: 'unassigned' });
      setProvisioning(next); setStage('write'); await onChanged();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Setup could not be prepared.'); }
    setBusy(false);
  };
  const write = async () => {
    if (!provisioning) return;
    setBusy(true); setMessage('Hold the top of your phone against the NTAG215 sticker.');
    try { await writeUrlToTag(provisioning.url); await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setStage('verify'); setMessage('Written successfully. Now verify the same sticker.'); }
    catch (reason) { setMessage(nfcMessage(reason)); }
    setBusy(false);
  };
  const verify = async () => {
    if (!provisioning) return;
    setBusy(true); setMessage('Hold the same sticker near your phone.');
    try {
      await verifyUrlOnTag(provisioning.url);
      await assignTag(session, data.gym.id, provisioning.machineId, { publicId: provisioning.publicId, labelCode: provisioning.labelCode, type: provisioning.tagType, status: 'active' });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setStage('success'); setMessage(''); await onChanged();
    } catch (reason) { setMessage(nfcMessage(reason)); }
    setBusy(false);
  };
  const restart = () => { setStage('choose'); setDraft(blankDraft()); setProvisioning(null); setMessage(''); setQuery(''); };

  if (stage === 'choose') return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Eyebrow>NFC setup</Eyebrow><Text style={styles.pageTitle}>Set up a tag</Text><Text style={styles.lead}>Choose an existing station to replace its sticker, or add a new machine from the catalog.</Text>
      <Field label="Find equipment" value={query} onChangeText={setQuery} placeholder="Try “leg press” or “rack”" />
      {message ? <Notice tone="danger">{message}</Notice> : null}
      {busy ? <ActivityIndicator color={colors.lime} /> : null}
      {!!data.machines.length && <><SectionTitle>Your equipment</SectionTitle>{data.machines.filter((machine) => `${machine.name} ${machine.stationCode}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8).map((machine) => <Pressable key={machine.id} onPress={() => chooseExisting(machine)}><Card style={styles.pickCard}><View><Text style={styles.machineName}>{machine.name}</Text><Text style={styles.muted}>Station {machine.stationCode} · {machine.tags.some((tag) => tag.status === 'active') ? 'Replace or verify tag' : 'Needs tag'}</Text></View><Text style={styles.chevron}>›</Text></Card></Pressable>)}</>}
      <SectionTitle>Machine catalog</SectionTitle>
      {catalog.slice(0, 20).map((item) => <Pressable key={item.name} onPress={() => chooseCatalog(item)}><Card style={styles.pickCard}><View><Text style={styles.machineName}>{item.name}</Text><Text style={styles.muted}>{item.category}</Text></View><Text style={styles.chevron}>＋</Text></Card></Pressable>)}
    </ScrollView>
  );

  if (stage === 'details') return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Pressable onPress={restart}><Text style={styles.backLink}>‹ Equipment</Text></Pressable><Eyebrow>Step 1 of 3</Eyebrow><Text style={styles.pageTitle}>Confirm station</Text>
      <Card style={styles.formCard}>
        <Field label="Machine name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
        <View style={styles.twoCol}><View style={styles.flex}><Field label="Station code" value={draft.stationCode} onChangeText={(stationCode) => setDraft({ ...draft, stationCode })} placeholder="08 or A3" /></View><View style={styles.flex}><Field label="Category" value={draft.category} onChangeText={(category) => setDraft({ ...draft, category })} /></View></View>
        <Field label="Primary muscles" value={draft.primaryMuscles.join(', ')} onChangeText={(value) => setDraft({ ...draft, primaryMuscles: csv(value) })} />
        <Notice>The station code can contain letters or numbers. Strictly uses it on labels and in your dashboard.</Notice>
        {message ? <Notice tone="danger">{message}</Notice> : null}
        <Button label={provisioning ? 'Continue to reprogram' : 'Save and prepare tag'} onPress={prepare} loading={busy} disabled={!draft.name || !draft.stationCode || !draft.category || !draft.primaryMuscles.length} />
      </Card>
    </ScrollView>
  );

  if (!provisioning) return null;
  if (stage === 'write' || stage === 'verify') return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Pressable onPress={() => setStage('details')}><Text style={styles.backLink}>‹ Station details</Text></Pressable><Eyebrow>Step {stage === 'write' ? '2' : '3'} of 3</Eyebrow><Text style={styles.pageTitle}>{stage === 'write' ? 'Program sticker' : 'Verify sticker'}</Text>
      <Card style={styles.nfcCard}>
        <View style={styles.nfcWaves}><Text style={styles.nfcIcon}>)))</Text></View>
        <Text style={styles.nfcTitle}>{provisioning.machineName}</Text><Text style={styles.nfcStation}>STATION {draft.stationCode} · {provisioning.labelCode}</Text>
        <View style={styles.urlBox}><Text numberOfLines={2} style={styles.urlText}>{provisioning.url}</Text></View>
        <Text style={styles.nfcHelp}>{stage === 'write' ? 'Hold the top of your phone directly against the center of the blank NTAG215 sticker. Keep it still until your phone confirms the write.' : 'Tap the same sticker one more time. Strictly checks that it opens the correct machine before marking it active.'}</Text>
        {message ? <Notice tone={/successfully/i.test(message) ? 'success' : 'normal'}>{message}</Notice> : null}
        <Button label={stage === 'write' ? 'Write NFC tag' : 'Verify and activate'} onPress={stage === 'write' ? write : verify} loading={busy} />
        {stage === 'verify' ? <Button label="Write again" onPress={() => setStage('write')} tone="secondary" disabled={busy} /> : null}
      </Card>
      <Notice>iPhone can write NDEF-ready NTAG215 stickers. If a completely blank sticker is not recognized, format it once with an NFC utility, then return here.</Notice>
    </ScrollView>
  );

  return (
    <ScrollView contentContainerStyle={[styles.screen, styles.successScreen]}>
      <View style={styles.successCircle}><Text style={styles.successCheck}>✓</Text></View><Eyebrow>Ready for the floor</Eyebrow><Text style={styles.successTitle}>{provisioning.machineName} is live.</Text><Text style={styles.leadCentered}>Place the sticker where a member can comfortably tap a phone before their set.</Text>
      <Card style={styles.successDetails}><MiniStat value={draft.stationCode} label="station" /><MiniStat value="NTAG215" label="tag" /><MiniStat value="Verified" label="status" /></Card>
      <Button label="Open member page" onPress={() => Linking.openURL(provisioning.url)} />
      <Button label="Set up another tag" onPress={restart} tone="secondary" />
    </ScrollView>
  );
}

function AccountScreen({ session, data, onGymChange, onSwitchMember }: { session: Session; data: DashboardData; onGymChange: (id: string) => void; onSwitchMember: () => void }) {
  const [email, setEmail] = useState(''); const [role, setRole] = useState<OwnerRole>('manager'); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const sendInvite = async () => {
    setBusy(true); setMessage('');
    try { const result = await inviteOwner(session, data.gym.id, email.trim(), role); setMessage(result.message || 'Invitation sent.'); setEmail(''); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Invitation could not be sent.'); }
    setBusy(false);
  };
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Eyebrow>Account</Eyebrow><Text style={styles.pageTitle}>Owner settings</Text>
      <Card style={styles.gap12}><Text style={styles.machineName}>{session.user.email}</Text><Text style={styles.muted}>{data.access.role.toUpperCase()} · {data.gym.name}</Text></Card>
      {data.accessibleGyms.length > 1 ? <><SectionTitle>Your gyms</SectionTitle><View style={styles.chips}>{data.accessibleGyms.map((gym) => <Chip key={gym.id} label={gym.name} selected={gym.id === data.gym.id} onPress={() => onGymChange(gym.id)} />)}</View></> : null}
      {data.access.role === 'owner' ? <><SectionTitle>Invite your team</SectionTitle><Card style={styles.formCard}><Text style={styles.muted}>Only approved accounts can enter the owner app. Invite a manager or read-only viewer here.</Text><Field label="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="manager@gym.com" /><View style={styles.chips}>{(['manager', 'viewer', 'owner'] as OwnerRole[]).map((item) => <Chip key={item} label={item} selected={role === item} onPress={() => setRole(item)} />)}</View>{message ? <Notice tone={/sent|assigned|updated/i.test(message) ? 'success' : 'danger'}>{message}</Notice> : null}<Button label="Send owner invite" onPress={sendInvite} loading={busy} disabled={!email.includes('@')} /></Card></> : null}
      <SectionTitle>Support & legal</SectionTitle><Card style={styles.gap12}><Button label="Email Strictly support" onPress={() => Linking.openURL('mailto:getstrictly@gmail.com?subject=StrictlyNFC%20Owner%20Support')} tone="secondary" /><Button label="Open web dashboard" onPress={() => Linking.openURL('https://strictlyinc.com/owner')} tone="secondary" /><Button label="Privacy policy" onPress={() => Linking.openURL('https://strictlyinc.com/privacy')} tone="secondary" /><Button label="Terms of service" onPress={() => Linking.openURL('https://strictlyinc.com/terms')} tone="secondary" /></Card>
      <Button label="Switch to member mode" onPress={onSwitchMember} tone="secondary" />
      <Button label="Sign out" onPress={() => supabase.auth.signOut()} tone="danger" />
    </ScrollView>
  );
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: string }[] = [{ id: 'dashboard', label: 'Dashboard', icon: '▦' }, { id: 'machines', label: 'Machines', icon: '▤' }, { id: 'setup', label: 'Set up', icon: '⌁' }, { id: 'account', label: 'Account', icon: '○' }];
  return <SafeAreaView edges={['bottom']} style={styles.tabSafe}><View style={styles.tabs}>{tabs.map((item) => <Pressable key={item.id} onPress={() => setTab(item.id)} style={[styles.tab, tab === item.id && styles.tabActive]}><Text style={[styles.tabIcon, tab === item.id && styles.tabIconActive]}>{item.icon}</Text><Text style={[styles.tabLabel, tab === item.id && styles.tabLabelActive]}>{item.label}</Text></Pressable>)}</View></SafeAreaView>;
}

function MiniStat({ value, label }: { value: string | number; label: string }) { return <View style={styles.miniStat}><Text style={styles.miniValue}>{value}</Text><Text style={styles.miniLabel}>{label}</Text></View>; }
function StrictlyMark() { return <View style={styles.mark}><Svg width="42" height="48" viewBox="0 0 100 113.2"><Polygon points="61.4,0 100,0 82.6,16.4 68.5,16.5 25.1,55.5 25,63 33.1,63.3 65.7,34.4 93.2,34.2 93.3,63.7 38.6,113.2 0,113.2 17.4,96.8 31.5,96.7 74.9,57.7 75,50.2 66.9,49.9 34.3,78.8 6.8,79 6.7,49.5" fill={colors.cream} /></Svg></View>; }
function Loading({ label }: { label: string }) { return <SafeAreaView style={[styles.safe, styles.loading]}><StrictlyMark /><ActivityIndicator color={colors.lime} size="large" /><Text style={styles.muted}>{label}</Text></SafeAreaView>; }
function AccessError({ error, onRetry }: { error: string; onRetry: () => void }) { return <SafeAreaView style={[styles.safe, styles.centered]}><View style={styles.errorWrap}><Eyebrow>Access needs attention</Eyebrow><Text style={styles.pageTitle}>This account is not assigned to a gym.</Text><Notice tone="danger">{error}</Notice><Button label="Try again" onPress={onRetry} /><Button label="Sign out" onPress={() => supabase.auth.signOut()} tone="secondary" /></View></SafeAreaView>; }
function nfcMessage(reason: unknown) { const raw = reason instanceof Error ? reason.message : 'The tag could not be read.'; if (/cancel|invalidate/i.test(raw)) return 'NFC scan canceled. Your setup is saved, so you can try again.'; if (/NDEF|tech|tag/i.test(raw)) return `${raw} Make sure this is an unlocked, NDEF-compatible NTAG215 sticker.`; return raw; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.forest }, app: { flex: 1 }, screen: { padding: 20, paddingBottom: 36, gap: 18 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 18 }, centered: { flex: 1, justifyContent: 'center' }, errorWrap: { padding: 24, gap: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, pageTitle: { color: colors.cream, fontSize: 36, lineHeight: 40, fontFamily: fonts.bold, marginTop: 5 , letterSpacing: -1.1 },
  livePill: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.panel }, liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.mint }, liveText: { color: colors.mint, fontSize: 11, fontFamily: fonts.bold, letterSpacing: 1 },
  mark: { width: 66, height: 66, borderRadius: 16, backgroundColor: colors.panelRaised, alignItems: 'center', justifyContent: 'center' },
  authScroll: { padding: 26, paddingTop: 56, gap: 18 }, authTitle: { color: colors.cream, fontSize: 46, lineHeight: 48, fontFamily: fonts.bold , letterSpacing: -1.4 }, authCopy: { fontFamily: fonts.regular, color: colors.muted, fontSize: 18, lineHeight: 27 }, authCard: { gap: 16, marginTop: 8 }, authFine: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' }, textLink: { color: colors.lime, fontFamily: fonts.bold, textAlign: 'center', padding: 8 },
  heroCard: { backgroundColor: colors.black, padding: 22 }, heroNumber: { color: colors.cream, fontSize: 72, lineHeight: 80, fontFamily: fonts.bold, marginTop: 10 , letterSpacing: -2.2 }, heroLabel: { fontFamily: fonts.regular, color: colors.muted, fontSize: 17 }, statRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, marginTop: 20, paddingTop: 18 }, miniStat: { flex: 1, gap: 3 }, miniValue: { color: colors.cream, fontSize: 19, fontFamily: fonts.bold }, miniLabel: { fontFamily: fonts.regular, color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: .8 },
  chart: { height: 168, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 7 }, barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6 }, bar: { width: '72%', maxWidth: 28, borderRadius: 10, backgroundColor: colors.lime }, barValue: { color: colors.cream, fontSize: 10, fontFamily: fonts.bold }, barLabel: { fontFamily: fonts.regular, color: colors.muted, fontSize: 11 },
  gap12: { gap: 12 }, flex: { flex: 1 }, rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 5 }, rank: { color: colors.lime, fontFamily: fonts.bold, fontSize: 13 }, rankValue: { color: colors.cream, fontFamily: fonts.bold }, machineName: { color: colors.cream, fontSize: 17, fontFamily: fonts.bold }, muted: { fontFamily: fonts.regular, color: colors.muted, fontSize: 13, lineHeight: 19 },
  setupCallout: { gap: 18, backgroundColor: colors.panelRaised }, calloutTitle: { color: colors.cream, fontSize: 25, fontFamily: fonts.bold, marginVertical: 7 , letterSpacing: -0.8 }, lead: { fontFamily: fonts.regular, color: colors.muted, fontSize: 17, lineHeight: 25 }, leadCentered: { fontFamily: fonts.regular, color: colors.muted, fontSize: 17, lineHeight: 25, textAlign: 'center' },
  backLink: { color: colors.lime, fontSize: 16, fontFamily: fonts.bold, paddingVertical: 5 }, formCard: { gap: 16 }, twoCol: { flexDirection: 'row', gap: 12 }, tagRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottomColor: colors.border, borderBottomWidth: 1 }, tagCheck: { color: colors.mint, fontSize: 22, fontFamily: fonts.bold },
  machineCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14 }, machineCode: { width: 49, height: 49, borderRadius: 15, backgroundColor: colors.panelRaised, alignItems: 'center', justifyContent: 'center' }, machineCodeText: { color: colors.lime, fontFamily: fonts.bold }, statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }, statusDotActive: { backgroundColor: colors.mint },
  pickCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 }, chevron: { color: colors.lime, fontSize: 28, fontFamily: fonts.medium }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nfcCard: { alignItems: 'stretch', gap: 18, padding: 22 }, nfcWaves: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.lime, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }, nfcIcon: { color: colors.black, fontSize: 25, fontFamily: fonts.bold, letterSpacing: -0.8 }, nfcTitle: { color: colors.cream, fontSize: 29, fontFamily: fonts.bold, textAlign: 'center' , letterSpacing: -0.9 }, nfcStation: { color: colors.mint, fontSize: 12, fontFamily: fonts.bold, letterSpacing: 1.4, textAlign: 'center' }, urlBox: { backgroundColor: colors.black, padding: 14, borderRadius: 14 }, urlText: { fontFamily: fonts.regular, color: colors.cream, textAlign: 'center', fontSize: 13 }, nfcHelp: { fontFamily: fonts.regular, color: colors.muted, textAlign: 'center', fontSize: 16, lineHeight: 24 },
  successScreen: { alignItems: 'stretch', justifyContent: 'center', minHeight: '100%' }, successCircle: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }, successCheck: { color: colors.black, fontSize: 48, fontFamily: fonts.bold , letterSpacing: -1.4 }, successTitle: { color: colors.cream, fontSize: 35, lineHeight: 41, fontFamily: fonts.bold, textAlign: 'center' , letterSpacing: -1.1 }, successDetails: { flexDirection: 'row' },
  tabSafe: { backgroundColor: colors.black, borderTopWidth: 1, borderTopColor: colors.border }, tabs: { height: 67, flexDirection: 'row', paddingHorizontal: 8, gap: 4 }, tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 16, marginVertical: 6 }, tabActive: { backgroundColor: colors.panelRaised }, tabIcon: { fontFamily: fonts.regular, color: colors.muted, fontSize: 19 }, tabIconActive: { color: colors.lime }, tabLabel: { color: colors.muted, fontSize: 10, fontFamily: fonts.semibold }, tabLabelActive: { color: colors.cream },
  roleScreen: { flex: 1, padding: 24, paddingTop: 38, paddingBottom: 22, justifyContent: 'space-between' }, roleLogo: { width: 64, height: 64 }, roleIntro: { gap: 14, marginTop: 'auto', marginBottom: 34 }, roleBrand: { color: colors.dim, fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, letterSpacing: 2.2 }, roleTitle: { color: colors.cream, fontSize: 43, lineHeight: 46, fontFamily: fonts.bold, letterSpacing: -1.3 }, roleCopy: { fontFamily: fonts.regular, color: colors.muted, fontSize: 17, lineHeight: 25, maxWidth: 430 }, roleActions: { gap: 12 }, rolePrimary: { minHeight: 102, borderRadius: 16, padding: 16, backgroundColor: colors.lime, flexDirection: 'row', alignItems: 'center', gap: 13 }, roleActionIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: 'rgba(7,10,2,0.12)', alignItems: 'center', justifyContent: 'center' }, roleActionIconText: { color: colors.black, fontSize: 24, fontFamily: fonts.bold , letterSpacing: -0.7 }, rolePrimaryTitle: { color: colors.black, fontSize: 19, fontFamily: fonts.bold }, rolePrimaryCopy: { fontFamily: fonts.regular, color: '#2B3510', fontSize: 12, lineHeight: 17, marginTop: 3 }, roleArrowDark: { fontFamily: fonts.regular, color: colors.black, fontSize: 30 }, roleSecondary: { minHeight: 102, borderRadius: 16, padding: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 13 }, roleOwnerIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, roleOwnerIconText: { color: colors.lime, fontSize: 19, fontFamily: fonts.bold }, roleSecondaryTitle: { color: colors.cream, fontSize: 19, fontFamily: fonts.bold }, roleSecondaryCopy: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 }, roleArrowLight: { fontFamily: fonts.regular, color: colors.cream, fontSize: 30 }, rolePressed: { opacity: .88, transform: [{ scale: .99 }] }, roleFine: { fontFamily: fonts.regular, color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 17 }, authBack: { alignSelf: 'flex-start' }
});
