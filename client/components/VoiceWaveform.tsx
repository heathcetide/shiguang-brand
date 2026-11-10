import React, { useEffect } from "react";
import { Animated, Easing, TouchableOpacity, ActivityIndicator } from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";

export type VoiceState =
  | "idle"
  | "listening"
  | "recognizing"
  | "thinking"
  | "speaking"
  | "completed";

interface VoiceWaveformProps {
  voiceState: VoiceState;
  onPress: () => void;
  /** sm = 底部栏用 (40px), lg = 全屏弹窗用 (64px) */
  size?: "sm" | "lg";
}

/**
 * 语音波形脉冲动画组件。
 * 中央一个可按压的圆形按钮，外围有脉冲圆环动画。
 * 颜色根据 voiceState 变化：idle=品牌色, listening=红色, speaking=蓝色, thinking/recognizing=琥珀色。
 */
export function VoiceWaveform({
  voiceState,
  onPress,
  size = "sm",
}: VoiceWaveformProps) {
  const isSm = size === "sm";
  const ringSize = isSm ? 30 : 64;
  const btnSize = isSm ? 22 : 44;
  const iconSize = isSm ? 11 : 20;

  // 动画值
  const [pulseAnim] = React.useState(() => new Animated.Value(1));

  // 脉冲动画：在 listening / speaking 状态下循环
  useEffect(() => {
    if (voiceState === "listening" || voiceState === "speaking") {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [voiceState, pulseAnim]);

  // 颜色映射
  const getBorderColor = () => {
    switch (voiceState) {
      case "listening":
        return "border-critical bg-critical/20";
      case "speaking":
        return "border-info bg-info/20";
      case "thinking":
      case "recognizing":
        return "border-warm bg-warm/20";
      default:
        return "border-brand bg-brand/10";
    }
  };

  const getBtnColor = () => {
    switch (voiceState) {
      case "listening":
        return "bg-critical-fill";
      case "speaking":
        return "bg-info-fill";
      case "thinking":
      case "recognizing":
        return "bg-warm-fill";
      default:
        return "bg-brand-fill";
    }
  };

  const getIconName = () => {
    if (voiceState === "thinking") return null; // 显示 spinner
    if (voiceState === "speaking") return "stop";
    if (voiceState === "listening" || voiceState === "recognizing")
      return "waveform";
    return "microphone";
  };

  return (
    <Animated.View
      style={{
        width: ringSize,
        height: ringSize,
        transform: [{ scale: pulseAnim }],
      }}
      className={`rounded-full items-center justify-center border-2 ${getBorderColor()}`}
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={{ width: btnSize, height: btnSize }}
        className={`rounded-full items-center justify-center shadow ${getBtnColor()}`}
      >
        {voiceState === "thinking" ? (
          <ActivityIndicator colorClassName="accent-on-brand" size={isSm ? "small" : "small"} />
        ) : (
          <FontAwesome6
            name={getIconName()!}
            size={iconSize}
            colorClassName="accent-on-brand"
          />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}
