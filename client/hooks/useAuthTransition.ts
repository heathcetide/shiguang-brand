import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Keyboard } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/** Animate just the auth form; keep navigation, safe areas and scroll handling intact. */
export function useAuthTransition(direction: 1 | -1) {
  const focused = useIsFocused();
  const [progress] = useState(() => new Animated.Value(0));
  const leaving = useRef(false);
  // Reveal only after the preference resolves, avoiding a visible frame before fade-in.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [phase, setPhase] = useState({ focused, reduceMotion, switching: false });
  // Reset before rendering a newly focused form, rather than cascading state in an effect.
  if (phase.focused !== focused || phase.reduceMotion !== reduceMotion) {
    setPhase({ focused, reduceMotion, switching: false });
  }

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active) setReduceMotion(value);
    }).catch(() => {
      if (active) setReduceMotion(true);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    progress.stopAnimation();
    leaving.current = false;
    if (reduceMotion === null) return;
    if (!focused || reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 460,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => { animation.stop(); progress.stopAnimation(); };
  }, [focused, progress, reduceMotion]);

  const switchScreen = useCallback((navigate: () => void) => {
    if (leaving.current) return;
    Keyboard.dismiss();
    if (reduceMotion !== false) {
      leaving.current = true;
      navigate();
      return;
    }
    leaving.current = true;
    setPhase(current => ({ ...current, switching: true }));
    Animated.timing(progress, {
      toValue: 0,
      duration: 300,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished) navigate(); });
  }, [progress, reduceMotion]);

  return {
    switching: phase.switching,
    switchScreen,
    animatedStyle: {
      opacity: progress,
      transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [direction * 16, 0] }) }],
    },
  };
}
