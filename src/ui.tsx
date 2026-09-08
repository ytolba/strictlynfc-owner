import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors } from './theme';

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
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [
      styles.button, compact && styles.buttonCompact, tone === 'secondary' && styles.buttonSecondary,
      tone === 'danger' && styles.buttonDanger, (disabled || loading) && styles.disabled, pressed && styles.pressed
    ]}>
      {loading ? <ActivityIndicator color={tone === 'lime' ? colors.black : colors.cream} /> : <Text style={[styles.buttonText, tone !== 'lime' && styles.buttonTextLight]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, multiline, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor="#7E907F"
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
  return <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{children}</Text>{action}</View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return <Pressable onPress={onPress} disabled={!onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 24, padding: 18 },
  eyebrow: { color: colors.mint, fontSize: 12, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  button: { minHeight: 54, borderRadius: 18, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime },
  buttonCompact: { minHeight: 42, borderRadius: 14, paddingHorizontal: 14 },
  buttonSecondary: { backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: '#542A24', borderWidth: 1, borderColor: '#82483E' },
  buttonText: { color: colors.black, fontSize: 16, fontWeight: '900' },
  buttonTextLight: { color: colors.cream }, disabled: { opacity: .48 }, pressed: { transform: [{ scale: .985 }], opacity: .9 },
  fieldWrap: { gap: 8 }, fieldLabel: { color: colors.cream, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.black, color: colors.cream, borderRadius: 16, paddingHorizontal: 15, fontSize: 16 },
  multiline: { minHeight: 112, paddingTop: 14, textAlignVertical: 'top' }, hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  notice: { padding: 14, borderRadius: 16, backgroundColor: '#193A29', borderWidth: 1, borderColor: colors.border },
  noticeSuccess: { borderColor: colors.mint }, noticeDanger: { borderColor: colors.danger, backgroundColor: '#41251F' }, noticeText: { color: colors.cream, lineHeight: 20 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { color: colors.cream, fontSize: 24, fontWeight: '900' },
  chip: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.lime, borderColor: colors.lime }, chipText: { color: colors.cream, fontSize: 13, fontWeight: '700' }, chipTextSelected: { color: colors.black }
});
