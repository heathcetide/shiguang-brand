import { Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

type PercentRingProps = {
  percent: number | null | undefined;
  size?: number;
  strokeWidth?: number;
  progressColor?: string;
  label?: string;
  emptyLabel?: string;
};

/** Compact circular progress for home calorie / water style metrics. */
export function PercentRing({
  percent,
  size = 44,
  strokeWidth = 4,
  progressColor = "#2F6B4F",
  label,
  emptyLabel = "—",
}: PercentRingProps) {
  const clamped = percent == null || Number.isNaN(percent) ? null : Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = clamped == null ? circumference : circumference * (1 - clamped / 100);
  const display = label ?? (clamped == null ? emptyLabel : `${Math.round(clamped)}%`);

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(47,107,79,0.15)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={progressColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text className="text-[9px] font-black text-brand" numberOfLines={1}>
        {display}
      </Text>
    </View>
  );
}
