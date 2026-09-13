import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../theme';

export function formatElapsed(startedAt: string, now = Date.now()) {
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function useElapsed(startedAt?: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt ? formatElapsed(startedAt, now) : null;
}

export function WorkoutTimerBar({ startedAt, gymName, setCount, onPress }: { startedAt: string; gymName: string; setCount: number; onPress?: () => void }) {
  const elapsed = useElapsed(startedAt);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Workout in progress, ${elapsed} elapsed, ${setCount} sets`} onPress={onPress} disabled={!onPress} style={styles.bar}>
      <View style={styles.dot} />
      <View style={styles.flex}>
        <Text style={styles.label}>WORKOUT · {gymName.toUpperCase()}</Text>
        <Text style={styles.meta}>{setCount} {setCount === 1 ? 'set' : 'sets'} logged</Text>
      </View>
      <Text style={styles.time}>{elapsed}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(205,245,100,0.35)' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.lime },
  flex: { flex: 1 },
  label: { color: colors.dim, fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.1 },
  meta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  time: { color: colors.lime, fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.6, fontVariant: ['tabular-nums'] }
});
