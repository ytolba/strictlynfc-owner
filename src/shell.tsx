import { useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as AppleAuthentication from 'expo-apple-authentication';
import { isAppleSignInAvailable, isCanceled, loadEnabledProviders, signInWithApple, signInWithGoogle, type AuthProviders } from './auth';
import { colors, fonts } from './theme';

// Screen chrome shared by member and owner modes, so both read as one app.
export type IconName = keyof typeof Ionicons.glyphMap;
export type TabItem<T extends string> = { id: T; label: string; icon: IconName; active: IconName };

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <View style={styles.pageHeader}><Text accessibilityRole="header" style={styles.pageTitle} numberOfLines={2}>{title}</Text>{action}</View>;
}

export function BrandMark() {
  return <View style={styles.brandMark}><Ionicons name="pulse" size={22} color={colors.lime} /></View>;
}

export function IconBack({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onPress} style={styles.backButton}><Ionicons name="chevron-back" size={24} color={colors.text} /></Pressable>;
}

export function SettingRow({ icon, title, copy, children, chevron }: { icon: IconName; title: string; copy?: string; children?: ReactNode; chevron?: boolean }) {
  return <View style={styles.settingRow}><View style={styles.settingIcon}><Ionicons name={icon} size={20} color={colors.lime} /></View><View style={styles.flex}><Text style={styles.rowTitle}>{title}</Text>{copy ? <Text style={styles.rowMeta}>{copy}</Text> : null}</View>{children}{chevron ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}</View>;
}

export function EmptyRow({ icon, title, copy }: { icon: IconName; title: string; copy: string }) {
  return <View style={styles.emptyRow}><Ionicons name={icon} size={24} color={colors.muted} /><View style={styles.flex}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowMeta}>{copy}</Text></View></View>;
}

export function List({ children }: PropsWithChildren) {
  return <View style={styles.list}>{children}</View>;
}

export function ListRow({ badge, icon, title, meta, trailing, onPress }: { badge?: string; icon?: IconName; title: string; meta?: string; trailing?: ReactNode; onPress?: () => void }) {
  const lead = badge !== undefined
    ? <View style={styles.badge}><Text numberOfLines={1} style={styles.badgeText}>{badge}</Text></View>
    : icon ? <View style={styles.badge}><Ionicons name={icon} size={20} color={colors.lime} /></View> : null;
  const content = <>{lead}<View style={styles.flex}><Text style={styles.rowTitle}>{title}</Text>{meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}</View>{trailing ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null)}</>;
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>{content}</Pressable>
    : <View style={styles.row}>{content}</View>;
}

export function AppTabBar<T extends string>({ tabs, tab, onChange }: { tabs: TabItem<T>[]; tab: T; onChange: (tab: T) => void }) {
  return <SafeAreaView edges={['bottom']} style={styles.tabSafe}><View style={styles.tabs}>{tabs.map((item) => {
    const active = tab === item.id;
    return <Pressable accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: active }} key={item.id} onPress={() => { if (!active) { void Haptics.selectionAsync().catch(() => undefined); onChange(item.id); } }} style={styles.tab}><Ionicons name={active ? item.active : item.icon} size={22} color={active ? colors.lime : colors.muted} /><Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text></Pressable>;
  })}</View></SafeAreaView>;
}

export function TextLink({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={styles.textLink}><Text style={[styles.textLinkText, disabled && styles.dim]}>{label}</Text></Pressable>;
}

export function AuthDivider({ label }: { label: string }) {
  return <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>{label}</Text><View style={styles.dividerLine} /></View>;
}

// Apple's own button is used on iOS, as App Review expects for Sign in with Apple. Only providers enabled in
// Supabase are shown, and on iOS Google appears only alongside Apple (guideline 4.8). With neither, the
// whole block and its divider disappear, leaving email sign-in.
export function SocialSignIn({ onMessage, disabled, dividerLabel = 'OR USE EMAIL' }: { onMessage: (message: string) => void; disabled?: boolean; dividerLabel?: string }) {
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [providers, setProviders] = useState<AuthProviders>({ apple: false, google: false });
  useEffect(() => {
    let active = true;
    Promise.all([loadEnabledProviders(), isAppleSignInAvailable().catch(() => false)]).then(([enabled, appleDevice]) => {
      if (!active) return;
      const apple = enabled.apple && appleDevice;
      setProviders({ apple, google: enabled.google && (Platform.OS !== 'ios' || apple) });
    });
    return () => { active = false; };
  }, []);
  if (!providers.apple && !providers.google) return null;
  const appleAvailable = providers.apple;
  const locked = disabled || !!busy;
  const run = async (provider: 'apple' | 'google', action: () => Promise<void>) => {
    setBusy(provider); onMessage('');
    try { await action(); }
    catch (reason) { if (!isCanceled(reason)) onMessage(reason instanceof Error ? reason.message : 'Sign-in did not finish.'); }
    setBusy(null);
  };
  return <View style={styles.social}>
    {appleAvailable ? <View pointerEvents={locked ? 'none' : 'auto'} style={locked && styles.dim}><AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE} cornerRadius={26} style={styles.appleButton} onPress={() => run('apple', signInWithApple)} /></View> : null}
    {providers.google ? <Pressable accessibilityRole="button" accessibilityLabel="Continue with Google" onPress={() => run('google', signInWithGoogle)} disabled={locked} style={({ pressed }) => [styles.googleButton, locked && styles.dim, pressed && styles.rowPressed]}>
      {busy === 'google' ? <ActivityIndicator color={colors.text} /> : <><Ionicons name="logo-google" size={18} color={colors.text} /><Text style={styles.googleText}>Continue with Google</Text></>}
    </Pressable> : null}
    <AuthDivider label={dividerLabel} />
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, dim: { opacity: .45 },
  pageHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pageTitle: { flexShrink: 1, color: colors.text, fontSize: 34, lineHeight: 40, fontFamily: fonts.bold, letterSpacing: -1.0 },
  brandMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  backButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: colors.text, fontSize: 16, lineHeight: 21, fontFamily: fonts.semibold }, rowMeta: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, lineHeight: 18 },
  settingRow: { minHeight: 72, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14 },
  settingIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  emptyRow: { minHeight: 82, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  list: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, rowPressed: { opacity: .88 },
  badge: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, badgeText: { color: colors.lime, fontSize: 12, fontFamily: fonts.bold },
  tabSafe: { backgroundColor: colors.black, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, tabs: { height: 66, flexDirection: 'row', paddingHorizontal: 8 },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 }, tabText: { color: colors.muted, fontSize: 10, fontFamily: fonts.semibold }, tabTextActive: { color: colors.text },
  textLink: { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }, textLinkText: { color: colors.lime, fontFamily: fonts.semibold, fontSize: 14 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 }, dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }, dividerText: { color: colors.muted, fontSize: 10, fontFamily: fonts.bold, letterSpacing: 1.1 },
  social: { gap: 10 }, appleButton: { width: '100%', height: 52 },
  googleButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, googleText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 16 }
});
