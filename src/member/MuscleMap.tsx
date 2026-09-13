import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';
import { colors, fonts } from '../theme';

type Props = { primary: string[]; assisting: string[]; accent?: string };

const normalize = (value: string) => value.toLowerCase().replace(/latissimus dorsi/g, 'lats').replace(/deltoids?/g, 'shoulders').replace(/front delts?/g, 'shoulders').replace(/rear delts?/g, 'shoulders').replace(/quadriceps/g, 'quads').replace(/abdominals?/g, 'core').trim();

export function MuscleMap({ primary, assisting, accent = colors.lime }: Props) {
  const primarySet = new Set(primary.map(normalize));
  const assistSet = new Set(assisting.map(normalize));
  const fillFor = (key: string) => primarySet.has(key) ? accent : assistSet.has(key) ? `${accent}72` : '#2A2E30';
  const common = { stroke: '#08090A', strokeWidth: 1.5, strokeLinejoin: 'round' as const };

  return (
    <View accessibilityRole="image" accessibilityLabel={`Muscle map. Primary: ${primary.join(', ')}. Assisting: ${assisting.join(', ') || 'none'}.`} style={styles.wrap}>
      <Svg width="100%" height={252} viewBox="0 0 340 250">
        <G transform="translate(40 3)">
          <Path d="M45 2 53 0 61 3 64 12 61 23 53 28 45 23 42 12Z" fill="#2A2E30" {...common} />
          <Path d="M47 25 59 25 61 35 45 35Z" fill="#2A2E30" {...common} />
          <Path d="M44 34 31 37 24 45 25 56 38 51Z" fill={fillFor('shoulders')} {...common} /><Path d="M62 34 75 37 82 45 81 56 68 51Z" fill={fillFor('shoulders')} {...common} />
          <Path d="M39 39 52 36 52 59 38 56 34 47Z" fill={fillFor('chest')} {...common} /><Path d="M67 39 54 36 54 59 68 56 72 47Z" fill={fillFor('chest')} {...common} />
          <Path d="M25 54 36 52 31 76 22 80 18 70Z" fill={fillFor('biceps')} {...common} /><Path d="M81 54 70 52 75 76 84 80 88 70Z" fill={fillFor('biceps')} {...common} />
          <Path d="M21 79 31 78 23 105 14 109 12 102Z" fill="#2A2E30" {...common} /><Path d="M85 79 75 78 83 105 92 109 94 102Z" fill="#2A2E30" {...common} />
          <Path d="M39 59 52 61 52 105 43 98 37 77Z" fill={fillFor('core')} {...common} /><Path d="M67 59 54 61 54 105 63 98 69 77Z" fill={fillFor('core')} {...common} />
          <Path d="M37 78 43 100 38 116 30 101 31 84Z" fill="#2A2E30" {...common} /><Path d="M69 78 63 100 68 116 76 101 75 84Z" fill="#2A2E30" {...common} />
          <Path d="M40 104 51 108 49 119 36 118Z" fill="#2A2E30" {...common} /><Path d="M66 104 55 108 57 119 70 118Z" fill="#2A2E30" {...common} />
          <Path d="M49 119 52 120 51 165 43 144Z" fill={fillFor('adductors')} {...common} /><Path d="M57 119 54 120 55 165 63 144Z" fill={fillFor('adductors')} {...common} />
          <Path d="M36 119 48 120 43 164 35 176 29 153 30 131Z" fill={fillFor('quads')} {...common} /><Path d="M70 119 58 120 63 164 71 176 77 153 76 131Z" fill={fillFor('quads')} {...common} /><Path d="M48 121 51 166 43 171 40 153Z" fill={fillFor('quads')} {...common} /><Path d="M58 121 55 166 63 171 66 153Z" fill={fillFor('quads')} {...common} />
          <Path d="M34 176 44 173 45 184 35 188 30 184Z" fill="#2A2E30" {...common} /><Path d="M72 176 62 173 61 184 71 188 76 184Z" fill="#2A2E30" {...common} />
          <Path d="M35 189 45 186 43 220 36 230 30 219 31 200Z" fill={fillFor('calves')} {...common} /><Path d="M71 189 61 186 63 220 70 230 76 219 75 200Z" fill={fillFor('calves')} {...common} />
          <SvgText x="53" y="246" textAnchor="middle" fill={colors.muted} fontSize="10" fontWeight="700">FRONT</SvgText>
        </G>
        <G transform="translate(210 3)">
          <Path d="M45 2 53 0 61 3 64 12 61 23 53 28 45 23 42 12Z" fill="#2A2E30" {...common} />
          <Path d="M47 25 59 25 61 35 45 35Z" fill="#2A2E30" {...common} />
          <Path d="M44 34 31 37 24 45 25 56 38 51Z" fill={fillFor('shoulders')} {...common} /><Path d="M62 34 75 37 82 45 81 56 68 51Z" fill={fillFor('shoulders')} {...common} />
          <Path d="M45 34 52 29 52 67 38 53 39 39Z" fill={fillFor('upper back')} {...common} /><Path d="M61 34 54 29 54 67 68 53 67 39Z" fill={fillFor('upper back')} {...common} />
          <Path d="M25 54 36 52 31 78 22 81 18 70Z" fill={fillFor('triceps')} {...common} /><Path d="M81 54 70 52 75 78 84 81 88 70Z" fill={fillFor('triceps')} {...common} />
          <Path d="M21 80 31 79 23 105 14 109 12 102Z" fill="#2A2E30" {...common} /><Path d="M85 80 75 79 83 105 92 109 94 102Z" fill="#2A2E30" {...common} />
          <Path d="M38 54 52 68 51 96 40 108 34 83Z" fill={fillFor('lats')} {...common} /><Path d="M68 54 54 68 55 96 66 108 72 83Z" fill={fillFor('lats')} {...common} />
          <Path d="M47 69 52 70 52 108 42 112 40 96Z" fill={fillFor('lower back')} {...common} /><Path d="M59 69 54 70 54 108 64 112 66 96Z" fill={fillFor('lower back')} {...common} />
          <Path d="M40 109 51 110 52 130 47 143 34 137 32 124Z" fill={fillFor('glutes')} {...common} /><Path d="M66 109 55 110 54 130 59 143 72 137 74 124Z" fill={fillFor('glutes')} {...common} />
          <Path d="M34 139 47 145 48 169 42 178 32 175 27 151Z" fill={fillFor('hamstrings')} {...common} /><Path d="M72 139 59 145 58 169 64 178 74 175 79 151Z" fill={fillFor('hamstrings')} {...common} /><Path d="M48 145 52 137 51 172 44 177Z" fill={fillFor('hamstrings')} {...common} /><Path d="M58 145 54 137 55 172 62 177Z" fill={fillFor('hamstrings')} {...common} />
          <Path d="M35 190 44 187 43 217 37 230 30 219 31 200Z" fill={fillFor('calves')} {...common} /><Path d="M71 190 62 187 63 217 69 230 76 219 75 200Z" fill={fillFor('calves')} {...common} />
          <SvgText x="53" y="246" textAnchor="middle" fill={colors.muted} fontSize="10" fontWeight="700">BACK</SvgText>
        </G>
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={[styles.key, { backgroundColor: accent }]} /><Text style={styles.legendText}>Primary</Text></View>
        <View style={styles.legendItem}><View style={[styles.key, { backgroundColor: `${accent}72` }]} /><Text style={styles.legendText}>Assists</Text></View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.black, borderRadius: 16, padding: 12, paddingBottom: 16 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  key: { width: 11, height: 11, borderRadius: 3 },
  legendText: { color: colors.muted, fontSize: 12, fontFamily: fonts.semibold }
});
