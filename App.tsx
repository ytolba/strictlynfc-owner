import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl,
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
import { assignTag, inviteOwner, loadDashboard, loadMachine, saveMachine, uploadMachineVideo } from './src/api';
import { sendPasswordReset } from './src/auth';
import { draftFromCatalog, MACHINE_CATALOG, type CatalogMachine } from './src/catalog';
import { verifyUrlOnTag, writeUrlToTag } from './src/nfc';
import { AppTabBar, BrandMark, EmptyRow, IconBack, List, ListRow, PageHeader, SettingRow, SocialSignIn, TextLink, type TabItem } from './src/shell';
import { supabase } from './src/supabase';
import { colors, fonts } from './src/theme';
import type { DashboardData, Machine, MachineDraft, OwnerRole, ProvisioningDraft } from './src/types';
import { Button, Card, Chip, Field, Notice, SectionTitle } from './src/ui';
import { MemberApp } from './src/member/MemberApp';
import { deleteMemberAccount, machineLinkFromUrl } from './src/member/api';
import { ensureMemberSession } from './src/member/session';
import { clearMemberData } from './src/member/storage';

type Tab = 'dashboard' | 'machines' | 'setup' | 'account';
type AppMode = 'member' | 'owner';
// `openedAt` makes every tag tap a new value, so tapping the same machine again still reopens it.
type MachineLink = { publicId: string; exerciseSlug?: string; openedAt?: number };
const MODE_KEY = 'strictlyvision.app-mode.v1';

const OWNER_TABS: TabItem<Tab>[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid-outline', active: 'grid' },
  { id: 'machines', label: 'Machines', icon: 'barbell-outline', active: 'barbell' },
  { id: 'setup', label: 'Set up', icon: 'add-circle-outline', active: 'add-circle' },
  { id: 'account', label: 'Account', icon: 'person-outline', active: 'person' }
];
// Suggestions only: owners can type any category for a custom machine.
const CATEGORY_SUGGESTIONS = ['Lower body', 'Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Multi-station'];

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
      if (link) { setInitialLink({ ...link, openedAt: Date.now() }); chooseMode('member'); }
    });
    return () => { data.subscription.unsubscribe(); linkSubscription.remove(); };
  }, []);

  const chooseMode = async (next: AppMode) => {
    setMode(next); await AsyncStorage.setItem(MODE_KEY, next);
    // Checks the live session, so the stale `session` captured by the link listener can't trigger extra sign-ins.
    if (next === 'member') await ensureMemberSession();
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
          <Pressable accessibilityRole="button" onPress={onMember} style={({ pressed }) => [styles.rolePrimary, pressed && styles.pressed]}><View style={styles.roleActionIcon}><Ionicons name="barbell" size={24} color={colors.black} /></View><View style={styles.flex}><Text style={styles.rolePrimaryTitle}>I’m training</Text><Text style={styles.rolePrimaryCopy}>Scan equipment, log sets, and keep your progress.</Text></View><Ionicons name="chevron-forward" size={24} color={colors.black} /></Pressable>
          <Pressable accessibilityRole="button" onPress={onOwner} style={({ pressed }) => [styles.roleSecondary, pressed && styles.pressed]}><View style={styles.roleOwnerIcon}><Ionicons name="business" size={22} color={colors.lime} /></View><View style={styles.flex}><Text style={styles.roleSecondaryTitle}>I manage a gym</Text><Text style={styles.roleSecondaryCopy}>Owner dashboard, equipment, analytics, and NFC setup.</Text></View><Ionicons name="chevron-forward" size={24} color={colors.cream} /></Pressable>
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
  // Set when another tab asks Set up to open straight into a custom machine.
  const [customRequest, setCustomRequest] = useState(0);

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

  const createCustom = () => { setCustomRequest(Date.now()); setTab('setup'); };
  const body = tab === 'dashboard'
    ? <DashboardScreen data={data} refreshing={refreshing} onRefresh={() => refresh(activeGymId, true)} onStartSetup={() => setTab('setup')} />
    : tab === 'machines'
      ? <MachinesScreen session={session} data={data} onChanged={() => refresh(activeGymId, true)} onProgram={() => setTab('setup')} onCustom={createCustom} />
      : tab === 'setup'
        ? <SetupScreen session={session} data={data} customRequest={customRequest} onChanged={() => refresh(activeGymId, true)} />
        : <AccountScreen session={session} data={data} onGymChange={(id) => { setActiveGymId(id); refresh(id); }} onSwitchMember={onSwitchMember} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.app}>{body}</View>
      <AppTabBar tabs={OWNER_TABS} tab={tab} onChange={setTab} />
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
    if (!email.includes('@')) return setMessage('Enter your work email above, then tap Forgot password.');
    setBusy(true); setMessage('');
    try { await sendPasswordReset(email); setMessage('Password reset email sent. Open the link to choose a new password, then sign in here.'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'The reset email could not be sent.'); }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
          <IconBack onPress={onBack} />
          <Image source={require('./assets/strictlyvision-mark-transparent.png')} style={styles.roleLogo as ImageStyle} resizeMode="contain" />
          <View style={styles.gap10}><Text style={styles.roleBrand}>OWNER TOOLS</Text><Text style={styles.authTitle}>Your gym floor,{`\n`}in your pocket.</Text><Text style={styles.bodyMuted}>Program tags, manage equipment, and see how your floor is being used.</Text></View>
          <Card style={styles.formCard}>
            <SocialSignIn onMessage={setMessage} disabled={busy} />
            <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="owner@gym.com" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" placeholder="Your password" />
            {message ? <Notice tone={/sent/i.test(message) ? 'success' : 'danger'}>{message}</Notice> : null}
            <Button label="Sign in" onPress={signIn} loading={busy} disabled={!email.trim() || !password} />
            <TextLink label="Forgot password?" onPress={reset} disabled={busy} />
          </Card>
          <Text style={styles.fine}>Owner access is invite-only. Sign in with the same email your invitation was sent to.</Text>
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
      <PageHeader title={data.gym.name} action={<View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveLabel}>LIVE</Text></View>} />
      <View style={styles.panel}>
        <View><Text style={styles.metricLabel}>Today</Text><Text style={styles.heroNumber}>{data.summary.tapsToday}</Text><Text style={styles.bodyMuted}>member taps across your floor</Text></View>
        <View style={styles.metrics}><Metric value={data.summary.taps7Days} label="7 days" /><Metric value={data.summary.activeTagCount} label="active tags" /><Metric value={data.summary.machineCount} label="machines" /></View>
      </View>
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
      {top.length ? <List>{top.map((machine, index) => <ListRow key={machine.id} badge={`0${index + 1}`} title={machine.name} meta={`Station ${machine.stationCode}`} trailing={<Text style={styles.rowValue}>{machine.taps30Days}<Text style={styles.rowMetaInline}> taps</Text></Text>} />)}</List> : <EmptyRow icon="pulse-outline" title="No taps yet" copy="Activity will appear after members begin tapping tags." />}
      <View style={styles.panel}>
        <View style={styles.panelIcon}><Ionicons name="radio-outline" size={26} color={colors.black} /></View>
        <View style={styles.gap6}><Text style={styles.panelTitle}>Tag a machine in minutes.</Text><Text style={styles.bodyMuted}>Choose equipment or create your own, tap the sticker, verify it, and place it on the floor.</Text></View>
        <Button label="Start setup" onPress={onStartSetup} />
      </View>
    </ScrollView>
  );
}

function MachinesScreen({ session, data, onChanged, onProgram, onCustom }: { session: Session; data: DashboardData; onChanged: () => void; onProgram: () => void; onCustom: () => void }) {
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
      <IconBack onPress={() => { setSelected(null); setMessage(''); }} />
      <View><Text style={styles.kicker}>{selected.category.toUpperCase()} · STATION {selected.stationCode}</Text><Text style={styles.detailTitle}>{selected.name}</Text></View>
      <MachineForm draft={draft} onChange={setDraft} />
      {message ? <Notice tone={/updated/i.test(message) ? 'success' : 'normal'}>{message}</Notice> : null}
      <Button label="Save machine" onPress={save} loading={busy} disabled={!machineReady(draft)} />
      <Button label={selected.videoUrl ? 'Replace demo video' : 'Upload demo video'} onPress={upload} tone="secondary" disabled={busy} />
      <SectionTitle>Installed tags</SectionTitle>
      {selected.tags.length ? <List>{selected.tags.map((tag) => <ListRow key={tag.publicId} icon="radio-outline" title={tag.labelCode} meta={`${tag.type.toUpperCase()} · ${tag.status}`} trailing={<Ionicons name={tag.status === 'active' ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={tag.status === 'active' ? colors.lime : colors.muted} />} />)}</List> : <EmptyRow icon="radio-outline" title="No tag yet" copy="Program a sticker so members can open this machine." />}
      <Button label="Program or replace tag" onPress={onProgram} tone="secondary" />
    </ScrollView>
  );

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <PageHeader title="Machines" action={<BrandMark />} />
      <Field label="Search your floor" value={query} onChangeText={setQuery} placeholder="Name, station, or category" />
      {message ? <Notice tone="danger">{message}</Notice> : null}
      {busy ? <ActivityIndicator color={colors.lime} />
        : visible.length ? <List>{visible.map((machine) => <ListRow key={machine.id} badge={machine.stationCode} title={machine.name} meta={`${machine.category} · ${machine.taps30Days} taps / 30d`} onPress={() => openMachine(machine)} trailing={<View style={styles.rowTrail}><View style={[styles.statusDot, machine.tags.some((tag) => tag.status === 'active') && styles.statusDotActive]} /><Ionicons name="chevron-forward" size={18} color={colors.muted} /></View>} />)}</List>
          : <EmptyRow icon="barbell-outline" title={data.machines.length ? 'No matches' : 'No equipment yet'} copy={data.machines.length ? 'Try a different name, station, or category.' : 'Add equipment from the catalog or create a custom machine.'} />}
      <Button label="Add from catalog" onPress={onProgram} />
      <Button label="Create custom machine" onPress={onCustom} tone="secondary" />
    </ScrollView>
  );
}

function SetupScreen({ session, data, customRequest, onChanged }: { session: Session; data: DashboardData; customRequest: number; onChanged: () => void }) {
  const [stage, setStage] = useState<'choose' | 'details' | 'write' | 'verify' | 'success'>('choose');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<MachineDraft>(blankDraft());
  const [custom, setCustom] = useState(false);
  const [provisioning, setProvisioning] = useState<ProvisioningDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const catalog = MACHINE_CATALOG.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase()));
  const nextStation = String(data.summary.machineCount + 1).padStart(2, '0');

  const startCustom = (name = '') => { setDraft({ ...blankDraft(), name, stationCode: nextStation }); setProvisioning(null); setCustom(true); setStage('details'); setMessage(''); };
  useEffect(() => { if (customRequest) startCustom(); }, [customRequest]);
  const chooseCatalog = (item: CatalogMachine) => { setDraft(draftFromCatalog(item, nextStation)); setProvisioning(null); setCustom(false); setStage('details'); setMessage(''); };
  const chooseExisting = async (machine: Machine) => {
    setBusy(true); setMessage('');
    try {
      const result = await loadMachine(session, data.gym.id, machine.id);
      const full = result.machine;
      setDraft({ machineId: full.id, name: full.name, stationCode: full.stationCode, category: full.category, status: full.status, primaryMuscles: full.primaryMuscles, assistingMuscles: full.assistingMuscles, instructions: full.instructions });
      const tag = full.tags.find((item) => item.status === 'active') || full.tags[0];
      setProvisioning(tag ? { machineId: full.id, machineName: full.name, publicId: tag.publicId, labelCode: tag.labelCode, tagType: tag.type, url: `https://strictlyinc.com/t/${tag.publicId}` } : null);
      setCustom(false); setStage('details');
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
  const restart = () => { setStage('choose'); setDraft(blankDraft()); setProvisioning(null); setCustom(false); setMessage(''); setQuery(''); };

  if (stage === 'choose') {
    const typed = query.trim();
    const existing = data.machines.filter((machine) => `${machine.name} ${machine.stationCode}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
    return (
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <PageHeader title="Set up" action={<BrandMark />} />
        <Text style={styles.bodyMuted}>Replace a sticker on existing equipment, add a machine from the catalog, or create your own.</Text>
        <Field label="Find equipment" value={query} onChangeText={setQuery} placeholder="Try “leg press” or “rack”" />
        {message ? <Notice tone="danger">{message}</Notice> : null}
        {busy ? <ActivityIndicator color={colors.lime} /> : null}
        <Pressable accessibilityRole="button" onPress={() => startCustom(typed)}><SettingRow icon="create-outline" title="Create a custom machine" copy={typed ? `Name it “${typed}” and add your own details` : 'For equipment that isn’t in the catalog'} chevron /></Pressable>
        {existing.length ? <><SectionTitle>Your equipment</SectionTitle><List>{existing.map((machine) => <ListRow key={machine.id} badge={machine.stationCode} title={machine.name} meta={machine.tags.some((tag) => tag.status === 'active') ? 'Replace or verify tag' : 'Needs tag'} onPress={() => chooseExisting(machine)} />)}</List></> : null}
        <SectionTitle>Machine catalog</SectionTitle>
        {catalog.length ? <List>{catalog.slice(0, 20).map((item) => <ListRow key={item.name} icon="barbell-outline" title={item.name} meta={item.category} onPress={() => chooseCatalog(item)} trailing={<Ionicons name="add" size={22} color={colors.lime} />} />)}</List>
          : <EmptyRow icon="search-outline" title="Not in the catalog" copy="Create a custom machine above with your own name and details." />}
      </ScrollView>
    );
  }

  if (stage === 'details') return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <IconBack onPress={restart} />
      <View><Text style={styles.kicker}>STEP 1 OF 3</Text><Text style={styles.detailTitle}>{custom ? 'Custom machine' : draft.machineId ? 'Confirm station' : 'Add machine'}</Text>{custom ? <Text style={styles.bodyMuted}>Name it the way your members know it. You can edit these details later from Machines.</Text> : null}</View>
      <MachineForm draft={draft} onChange={setDraft} showSuggestions={custom} />
      <Notice>The station code can contain letters or numbers. Strictly uses it on labels and in your dashboard.</Notice>
      {message ? <Notice tone="danger">{message}</Notice> : null}
      <Button label={provisioning ? 'Continue to reprogram' : 'Save and prepare tag'} onPress={prepare} loading={busy} disabled={!machineReady(draft)} />
    </ScrollView>
  );

  if (!provisioning) return null;
  if (stage === 'write' || stage === 'verify') return (
    <ScrollView contentContainerStyle={styles.screen}>
      <IconBack onPress={() => setStage('details')} />
      <View><Text style={styles.kicker}>STEP {stage === 'write' ? '2' : '3'} OF 3</Text><Text style={styles.detailTitle}>{stage === 'write' ? 'Program sticker' : 'Verify sticker'}</Text></View>
      <View style={[styles.panel, styles.nfcPanel]}>
        <View style={styles.rings}><View style={styles.ringsInner}><Ionicons name="phone-portrait-outline" size={40} color={colors.lime} /></View></View>
        <Text style={styles.nfcTitle}>{provisioning.machineName}</Text><Text style={styles.nfcStation}>STATION {draft.stationCode} · {provisioning.labelCode}</Text>
        <View style={styles.urlBox}><Text numberOfLines={2} style={styles.urlText}>{provisioning.url}</Text></View>
        <Text style={styles.centerCopy}>{stage === 'write' ? 'Hold the top of your phone directly against the center of the blank NTAG215 sticker. Keep it still until your phone confirms the write.' : 'Tap the same sticker one more time. Strictly checks that it opens the correct machine before marking it active.'}</Text>
        {message ? <Notice tone={/successfully/i.test(message) ? 'success' : 'normal'}>{message}</Notice> : null}
        <Button label={stage === 'write' ? 'Write NFC tag' : 'Verify and activate'} onPress={stage === 'write' ? write : verify} loading={busy} />
        {stage === 'verify' ? <Button label="Write again" onPress={() => setStage('write')} tone="secondary" disabled={busy} /> : null}
      </View>
      <Notice>iPhone can write NDEF-ready NTAG215 stickers. If a completely blank sticker is not recognized, format it once with an NFC utility, then return here.</Notice>
    </ScrollView>
  );

  return (
    <ScrollView contentContainerStyle={[styles.screen, styles.successScreen]}>
      <View style={styles.successCircle}><Ionicons name="checkmark" size={52} color={colors.black} /></View>
      <View style={styles.gap10}><Text style={[styles.kicker, styles.center]}>READY FOR THE FLOOR</Text><Text style={styles.successTitle}>{provisioning.machineName} is live.</Text><Text style={styles.centerCopy}>Place the sticker where a member can comfortably tap a phone before their set.</Text></View>
      <View style={[styles.panel, styles.metrics]}><Metric value={draft.stationCode} label="station" /><Metric value="NTAG215" label="tag" /><Metric value="Verified" label="status" /></View>
      <Button label="Open member page" onPress={() => Linking.openURL(provisioning.url)} />
      <Button label="Set up another tag" onPress={restart} tone="secondary" />
    </ScrollView>
  );
}

// Every machine field the server requires; shared by catalog, custom, and edit flows.
function machineReady(draft: MachineDraft) {
  return draft.name.trim().length >= 2 && draft.category.trim().length >= 2 && !!draft.stationCode.trim() && draft.primaryMuscles.length > 0;
}

function MachineForm({ draft, onChange, showSuggestions }: { draft: MachineDraft; onChange: (draft: MachineDraft) => void; showSuggestions?: boolean }) {
  return (
    <Card style={styles.formCard}>
      <Field label="Machine name" value={draft.name} onChangeText={(name) => onChange({ ...draft, name })} placeholder="Example: Vault Belt Squat" maxLength={100} />
      <View style={styles.twoCol}><View style={styles.flex}><Field label="Station code" value={draft.stationCode} onChangeText={(stationCode) => onChange({ ...draft, stationCode })} placeholder="08 or A3" autoCapitalize="characters" maxLength={24} /></View><View style={styles.flex}><Field label="Category" value={draft.category} onChangeText={(category) => onChange({ ...draft, category })} placeholder="Lower body" maxLength={60} /></View></View>
      {showSuggestions ? <View style={styles.chips}>{CATEGORY_SUGGESTIONS.map((item) => <Chip key={item} label={item} selected={draft.category === item} onPress={() => onChange({ ...draft, category: item })} />)}</View> : null}
      <Field label="Primary muscles" value={draft.primaryMuscles.join(', ')} onChangeText={(value) => onChange({ ...draft, primaryMuscles: csv(value) })} placeholder="Quadriceps, Glutes" hint="Separate muscles with commas. At least one is required." />
      <Field label="Assisting muscles · optional" value={draft.assistingMuscles.join(', ')} onChangeText={(value) => onChange({ ...draft, assistingMuscles: csv(value) })} placeholder="Hamstrings, Core" />
      <Field label="Instructions · optional" multiline value={draft.instructions.join('\n')} onChangeText={(value) => onChange({ ...draft, instructions: lines(value) })} placeholder={'Set the seat height.\nBrace before each rep.'} hint="One short step per line. Members see these under How to." />
    </Card>
  );
}

function AccountScreen({ session, data, onGymChange, onSwitchMember }: { session: Session; data: DashboardData; onGymChange: (id: string) => void; onSwitchMember: () => void }) {
  const [email, setEmail] = useState(''); const [role, setRole] = useState<OwnerRole>('manager'); const [busy, setBusy] = useState(false); const [accountBusy, setAccountBusy] = useState(false); const [message, setMessage] = useState('');
  const sendInvite = async () => {
    setBusy(true); setMessage('');
    try { const result = await inviteOwner(session, data.gym.id, email.trim(), role); setMessage(result.message || 'Invitation sent.'); setEmail(''); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Invitation could not be sent.'); }
    setBusy(false);
  };
  const deleteAccount = () => Alert.alert('Delete your account?', 'This permanently removes your StrictlyVision account, gym access, and personal workout history. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete account', style: 'destructive', onPress: async () => {
      setAccountBusy(true);
      try {
        await deleteMemberAccount(session);
        await clearMemberData();
        await supabase.auth.signOut();
        Alert.alert('Account deleted', 'Your StrictlyVision account and associated access were removed.');
      } catch (reason) { Alert.alert('Could not delete account', reason instanceof Error ? reason.message : 'Please try again.'); }
      setAccountBusy(false);
    } }
  ]);
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <PageHeader title="Account" action={<BrandMark />} />
      <View style={styles.identity}><View style={styles.avatar}><Ionicons name="business" size={24} color={colors.lime} /></View><View style={styles.flex}><Text style={styles.identityName}>{session.user.email}</Text><Text style={styles.bodyMuted}>{data.access.role.charAt(0).toUpperCase() + data.access.role.slice(1)} · {data.gym.name}</Text></View></View>
      {data.accessibleGyms.length > 1 ? <><SectionTitle>Your gyms</SectionTitle><View style={styles.chips}>{data.accessibleGyms.map((gym) => <Chip key={gym.id} label={gym.name} selected={gym.id === data.gym.id} onPress={() => onGymChange(gym.id)} />)}</View></> : null}
      {data.access.role === 'owner' ? <><SectionTitle>Invite your team</SectionTitle><Card style={styles.formCard}><Text style={styles.bodyMuted}>Only approved accounts can enter owner tools. Invite a manager or read-only viewer here.</Text><Field label="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="manager@gym.com" /><View style={styles.chips}>{(['manager', 'viewer', 'owner'] as OwnerRole[]).map((item) => <Chip key={item} label={item.charAt(0).toUpperCase() + item.slice(1)} selected={role === item} onPress={() => setRole(item)} />)}</View>{message ? <Notice tone={/sent|assigned|updated/i.test(message) ? 'success' : 'danger'}>{message}</Notice> : null}<Button label="Send owner invite" onPress={sendInvite} loading={busy} disabled={!email.includes('@')} /></Card></> : null}
      <SectionTitle>Support & legal</SectionTitle>
      <Pressable onPress={() => Linking.openURL('mailto:getstrictly@gmail.com?subject=StrictlyVision%20Owner%20Support')}><SettingRow icon="mail-outline" title="Email Strictly support" chevron /></Pressable>
      <Pressable onPress={() => Linking.openURL('https://strictlyinc.com/owner')}><SettingRow icon="globe-outline" title="Open web dashboard" copy="strictlyinc.com/owner" chevron /></Pressable>
      <Pressable onPress={() => Linking.openURL('https://strictlyinc.com/privacy')}><SettingRow icon="shield-checkmark-outline" title="Privacy" chevron /></Pressable>
      <Pressable onPress={() => Linking.openURL('https://strictlyinc.com/terms')}><SettingRow icon="document-text-outline" title="Terms of service" chevron /></Pressable>
      <SectionTitle>App</SectionTitle>
      <Pressable onPress={onSwitchMember}><SettingRow icon="barbell-outline" title="Switch to member mode" copy="Scan equipment and log your own sets" chevron /></Pressable>
      <Button label="Sign out" onPress={() => supabase.auth.signOut()} tone="secondary" disabled={accountBusy} />
      <Button label="Delete account" onPress={deleteAccount} tone="danger" loading={accountBusy} disabled={accountBusy} />
    </ScrollView>
  );
}

function Metric({ value, label }: { value: string | number; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function Loading({ label }: { label: string }) { return <SafeAreaView style={[styles.safe, styles.loading]}><Image source={require('./assets/strictlyvision-mark-transparent.png')} style={styles.roleLogo as ImageStyle} resizeMode="contain" /><ActivityIndicator color={colors.lime} size="large" /><Text style={styles.bodyMuted}>{label}</Text></SafeAreaView>; }
function AccessError({ error, onRetry }: { error: string; onRetry: () => void }) { return <SafeAreaView style={styles.safe}><View style={[styles.screen, styles.errorWrap]}><Text style={styles.kicker}>ACCESS NEEDS ATTENTION</Text><Text style={styles.detailTitle}>This account isn’t assigned to a gym.</Text><Notice tone="danger">{error}</Notice><Text style={styles.bodyMuted}>If you signed in with Apple or Google, make sure it uses the same email your invitation was sent to.</Text><Button label="Try again" onPress={onRetry} /><Button label="Sign out" onPress={() => supabase.auth.signOut()} tone="secondary" /></View></SafeAreaView>; }
function nfcMessage(reason: unknown) { const raw = reason instanceof Error ? reason.message : 'The tag could not be read.'; if (/cancel|invalidate/i.test(raw)) return 'NFC scan canceled. Your setup is saved, so you can try again.'; if (/NDEF|tech|tag/i.test(raw)) return `${raw} Make sure this is an unlocked, NDEF-compatible NTAG215 sticker.`; return raw; }

// Values mirror the member screens (src/member/MemberApp.tsx) so both modes share one visual system.
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, app: { flex: 1 }, flex: { flex: 1 }, center: { textAlign: 'center' },
  screen: { padding: 20, paddingBottom: 38, gap: 24 }, loading: { alignItems: 'center', justifyContent: 'center', gap: 18 }, errorWrap: { flex: 1, justifyContent: 'center', gap: 16 },
  gap6: { gap: 6 }, gap10: { gap: 10 }, twoCol: { flexDirection: 'row', gap: 12 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, formCard: { gap: 16 },
  bodyMuted: { fontFamily: fonts.regular, color: colors.muted, fontSize: 15, lineHeight: 22 }, centerCopy: { fontFamily: fonts.regular, color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  kicker: { color: colors.dim, fontSize: 11, lineHeight: 16, fontFamily: fonts.bold, letterSpacing: 1.2 }, detailTitle: { color: colors.text, fontSize: 38, lineHeight: 42, fontFamily: fonts.bold, letterSpacing: -1.1, marginTop: 5 },
  fine: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' }, authTitle: { color: colors.text, fontSize: 40, lineHeight: 44, fontFamily: fonts.bold, letterSpacing: -1.2 },
  pressed: { opacity: .88, transform: [{ scale: .99 }] },
  liveBadge: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.lime }, liveLabel: { color: colors.lime, fontSize: 10, fontFamily: fonts.bold, letterSpacing: 1 },
  panel: { borderRadius: 16, backgroundColor: colors.black, padding: 20, gap: 18 }, panelIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime }, panelTitle: { color: colors.text, fontSize: 24, lineHeight: 29, fontFamily: fonts.bold, letterSpacing: -0.7 },
  heroNumber: { color: colors.lime, fontFamily: fonts.bold, fontSize: 56, lineHeight: 62, letterSpacing: -1.7, fontVariant: ['tabular-nums'] },
  metrics: { flexDirection: 'row', borderTopWidth: 1, borderColor: colors.border, paddingTop: 16 }, metric: { flex: 1, gap: 3 }, metricValue: { color: colors.text, fontSize: 21, fontFamily: fonts.bold }, metricLabel: { fontFamily: fonts.regular, color: colors.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: .7 },
  chart: { height: 168, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 7 }, barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6 }, bar: { width: '72%', maxWidth: 28, borderRadius: 7, backgroundColor: colors.lime }, barValue: { color: colors.text, fontSize: 10, fontFamily: fonts.bold }, barLabel: { fontFamily: fonts.regular, color: colors.muted, fontSize: 11 },
  rowValue: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold }, rowMetaInline: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 }, rowTrail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger }, statusDotActive: { backgroundColor: colors.lime },
  nfcPanel: { borderWidth: 1, borderColor: colors.border }, rings: { alignSelf: 'center', width: 136, height: 136, borderRadius: 68, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, ringsInner: { width: 94, height: 94, borderRadius: 47, borderWidth: 1, borderColor: colors.lime, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  nfcTitle: { color: colors.text, fontSize: 26, fontFamily: fonts.bold, textAlign: 'center', letterSpacing: -0.8 }, nfcStation: { color: colors.lime, fontSize: 11, fontFamily: fonts.bold, letterSpacing: 1.2, textAlign: 'center' }, urlBox: { backgroundColor: colors.surface, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border }, urlText: { fontFamily: fonts.regular, color: colors.text, textAlign: 'center', fontSize: 13 },
  successScreen: { justifyContent: 'center', minHeight: '100%' }, successCircle: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' }, successTitle: { color: colors.text, fontSize: 34, lineHeight: 40, fontFamily: fonts.bold, textAlign: 'center', letterSpacing: -1.0 },
  identity: { flexDirection: 'row', gap: 14, alignItems: 'center' }, avatar: { width: 58, height: 58, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, identityName: { color: colors.text, fontSize: 19, fontFamily: fonts.bold },
  roleScreen: { flex: 1, padding: 24, paddingTop: 38, paddingBottom: 22, justifyContent: 'space-between' }, roleLogo: { width: 64, height: 64 }, roleIntro: { gap: 14, marginTop: 'auto', marginBottom: 34 }, roleBrand: { color: colors.dim, fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, letterSpacing: 2.2 }, roleTitle: { color: colors.cream, fontSize: 43, lineHeight: 46, fontFamily: fonts.bold, letterSpacing: -1.3 }, roleCopy: { fontFamily: fonts.regular, color: colors.muted, fontSize: 17, lineHeight: 25, maxWidth: 430 }, roleActions: { gap: 12 }, rolePrimary: { minHeight: 102, borderRadius: 16, padding: 16, backgroundColor: colors.lime, flexDirection: 'row', alignItems: 'center', gap: 13 }, roleActionIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: 'rgba(7,10,2,0.12)', alignItems: 'center', justifyContent: 'center' }, rolePrimaryTitle: { color: colors.black, fontSize: 19, fontFamily: fonts.bold }, rolePrimaryCopy: { fontFamily: fonts.regular, color: '#2B3510', fontSize: 12, lineHeight: 17, marginTop: 3 }, roleSecondary: { minHeight: 102, borderRadius: 16, padding: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 13 }, roleOwnerIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, roleSecondaryTitle: { color: colors.cream, fontSize: 19, fontFamily: fonts.bold }, roleSecondaryCopy: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 }, roleFine: { fontFamily: fonts.regular, color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 17 }
});
