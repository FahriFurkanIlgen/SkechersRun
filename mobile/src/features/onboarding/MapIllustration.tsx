import Svg, { G, Line, Path, Pattern, Rect, Circle } from 'react-native-svg';
import { useTheme } from '../../theme/theme';

/**
 * Decorative welcome illustration from the design's map layer (streets, park,
 * shore, own vs. other territory and a finished route). Not real data.
 */
export function MapIllustration({ height }: { height: number }) {
  const { colors, dark } = useTheme();
  const m = dark
    ? { land: '#1A1E22', block: '#20262B', road: '#353D45', casing: '#121518', park: '#1D2B22', water: '#12222D' }
    : { land: '#ECEEE9', block: '#E1E4DD', road: '#FFFFFF', casing: '#CDD2CA', park: '#D3E5CA', water: '#C6DBE7' };
  const top = 420 - height / 2;
  return (
    <Svg width="100%" height={height} viewBox={`0 ${top} 390 ${height}`} preserveAspectRatio="xMidYMid slice">
      <Pattern id="ilOwn" width={9} height={9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <Rect width={9} height={9} fill={colors.ownFill} />
        <Line x1={0} y1={0} x2={0} y2={9} stroke={colors.ownStroke} strokeOpacity={0.45} strokeWidth={2.5} />
      </Pattern>
      <Pattern id="ilRival" width={10} height={10} patternUnits="userSpaceOnUse">
        <Rect width={10} height={10} fill={colors.rivalFill} />
        <Circle cx={5} cy={5} r={1.7} fill={colors.rivalStroke} fillOpacity={0.7} />
      </Pattern>
      <Rect x={-200} y={-200} width={790} height={1244} fill={m.land} />
      <Path d="M-20,740 C100,700 250,770 410,712 L410,900 L-20,900 Z" fill={m.water} />
      <Path d="M262,600 L382,560 L382,690 C330,700 290,705 262,712 Z" fill={m.park} />
      <G fill={m.block}>
        {[
          [156, 190, 80, 126], [264, 190, 54, 126], [62, 190, 64, 126], [156, 346, 80, 110], [62, 346, 64, 110],
          [264, 346, 54, 110], [62, 40, 64, 126], [156, 40, 80, 126], [62, 486, 64, 70], [156, 486, 80, 50],
        ].map(([x, y, w, h], i) => (
          <Rect key={i} x={x} y={y} width={w} height={h} rx={4} />
        ))}
      </G>
      <G stroke={m.casing} strokeLinecap="round" fill="none">
        <Path d="M-20,610 L410,520" strokeWidth={16} />
        <Path d="M140,-20 L140,760 M250,-20 L250,760 M-20,330 L410,330 M-20,470 L410,470" strokeWidth={12} />
        <Path d="M-20,178 L410,178 M335,-20 L335,560 M48,-20 L48,720" strokeWidth={9} />
      </G>
      <G stroke={m.road} strokeLinecap="round" fill="none">
        <Path d="M-20,610 L410,520" strokeWidth={12} />
        <Path d="M140,-20 L140,760 M250,-20 L250,760 M-20,330 L410,330 M-20,470 L410,470" strokeWidth={8} />
        <Path d="M-20,178 L410,178 M335,-20 L335,560 M48,-20 L48,720" strokeWidth={6} />
      </G>
      <Path
        d="M346,145 346,175 320,190 294,175 294,145 320,130ZM320,190 320,220 294,235 268,220 268,190 294,175ZM372,190 372,220 346,235 320,220 320,190 346,175ZM86,235 86,265 60,280 34,265 34,235 60,220ZM294,235 294,265 268,280 242,265 242,235 268,220ZM346,235 346,265 320,280 294,265 294,235 320,220ZM398,235 398,265 372,280 346,265 346,235 372,220ZM112,280 112,310 86,325 60,310 60,280 86,265Z"
        fill="url(#ilRival)"
        stroke={colors.rivalStroke}
        strokeWidth={2}
        strokeDasharray="6 4"
        strokeLinejoin="round"
      />
      <Path
        d="M268,280 268,310 242,325 216,310 216,280 242,265ZM190,325 190,355 164,370 138,355 138,325 164,310ZM242,325 242,355 216,370 190,355 190,325 216,310ZM164,370 164,400 138,415 112,400 112,370 138,355ZM216,370 216,400 190,415 164,400 164,370 190,355ZM268,370 268,400 242,415 216,400 216,370 242,355ZM138,415 138,445 112,460 86,445 86,415 112,400ZM190,415 190,445 164,460 138,445 138,415 164,400ZM242,415 242,445 216,460 190,445 190,415 216,400ZM164,460 164,490 138,505 112,490 112,460 138,445ZM216,460 216,490 190,505 164,490 164,460 190,445Z"
        fill="url(#ilOwn)"
        stroke={colors.ownStroke}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <G fill="none" strokeLinecap="round" strokeLinejoin="round">
        <Path d="M140,560 L140,330 L250,330 L250,470 L146,470 L146,552" stroke={colors.routeCasing} strokeWidth={11} />
        <Path d="M140,560 L140,330 L250,330 L250,470 L146,470 L146,552" stroke={colors.route} strokeWidth={6} />
      </G>
    </Svg>
  );
}
