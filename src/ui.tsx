import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, fonts, radius } from './theme';

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle | ViewStyle[] }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Eyebrow({ children }: PropsWithChildren) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function Button({ label, onPress, tone = 'lime', disabled, loading, compact }: {
  label: string; onPress: () => void; tone?: 'lime' | 'secondary' | 'danger'; disabled?: boolean; loading?: boolean; compact?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }} onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [
      styles.button, compact && styles.buttonCompact, tone === 'secondary' && styles.buttonSecondary,
      tone === 'danger' && styles.buttonDanger, pressed && tone === 'lime' && styles.buttonLimePressed,
      pressed && tone !== 'lime' && styles.buttonGhostPressed, (disabled || loading) && styles.disabled, pressed && styles.pressed
    ]}>
      {loading ? <ActivityIndicator color={tone === 'lime' ? colors.onLime : colors.text} /> : <Text style={[styles.buttonText, tone !== 'lime' && styles.buttonTextLight, tone === 'danger' && styles.buttonTextDanger]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, multiline, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel || label}
        multiline={multiline}
        placeholderTextColor={colors.dim}
        selectionColor={colors.lime}
        style={[styles.input, multiline && styles.multiline, props.style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({ children, tone = 'normal' }: PropsWithChildren<{ tone?: 'normal' | 'success' | 'danger' }>) {
  return <View style={[styles.notice, tone === 'success' && styles.noticeSuccess, tone === 'danger' && styles.noticeDanger]}><Text style={styles.noticeText}>{children}</Text></View>;
}

export function SectionTitle({ children, action }: PropsWithChildren<{ action?: ReactNode }>) {
  return <View style={styles.sectionHead}><Text accessibilityRole="header" style={styles.sectionTitle}>{children}</Text>{action}</View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected, disabled: !onPress }} onPress={onPress} disabled={!onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: 18 },
  eyebrow: { color: colors.dim, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15, letterSpacing: 1.4, textTransform: 'uppercase' },
  button: { minHeight: 52, borderRadius: radius.pill, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime, borderWidth: 1, borderColor: 'transparent' },
  buttonCompact: { minHeight: 44, paddingHorizontal: 16 },
  buttonSecondary: { backgroundColor: 'transparent', borderColor: colors.borderStrong },
  buttonDanger: { backgroundColor: 'transparent', borderColor: 'rgba(255,122,107,0.45)' },
  buttonLimePressed: { backgroundColor: colors.limePress },
  buttonGhostPressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  buttonText: { color: colors.onLime, fontFamily: fonts.semibold, fontSize: 16, letterSpacing: -0.1 },
  buttonTextLight: { color: colors.text }, buttonTextDanger: { color: colors.danger },
  disabled: { opacity: .45 }, pressed: { transform: [{ scale: .975 }] },
  fieldWrap: { gap: 8 }, fieldLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.bg, color: colors.text, fontFamily: fonts.regular, borderRadius: radius.sm, paddingHorizontal: 15, fontSize: 16 },
  multiline: { minHeight: 112, paddingTop: 14, textAlignVertical: 'top' }, hint: { color: colors.dim, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  notice: { padding: 14, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  noticeSuccess: { borderColor: 'rgba(205,245,100,0.35)', backgroundColor: colors.limeWash }, noticeDanger: { borderColor: 'rgba(255,122,107,0.4)', backgroundColor: 'rgba(255,122,107,0.08)' },
  noticeText: { color: colors.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 22, lineHeight: 27, letterSpacing: -0.5 },
  chip: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, minHeight: 48, justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.borderStrong },
  chipSelected: { backgroundColor: colors.lime, borderColor: colors.lime }, chipText: { color: colors.text, fontFamily: fonts.medium, fontSize: 13 }, chipTextSelected: { color: colors.onLime }
});
