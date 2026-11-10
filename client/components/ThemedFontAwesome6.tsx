import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import type { ComponentProps } from "react";
import { useCSSVariable } from "uniwind";

const COLOR_VARIABLES: Record<string, string> = {
  "accent-brand": "--color-brand",
  "accent-brand-strong": "--color-brand-strong",
  "accent-copy-muted": "--color-copy-muted",
  "accent-critical": "--color-critical",
  "accent-highlight": "--color-highlight",
  "accent-info": "--color-info",
  "accent-ink": "--color-ink",
  "accent-on-brand": "--color-on-brand",
  "accent-success": "--color-success",
  "accent-warm": "--color-warm",
};

type Props = ComponentProps<typeof FontAwesome6> & {
  colorClassName?: string;
};

/** Font Awesome wrapper that resolves semantic icon colors against the active theme. */
export default function ThemedFontAwesome6({ colorClassName, color, ...props }: Props) {
  const variable = COLOR_VARIABLES[colorClassName || "accent-ink"] || "--color-ink";
  const [resolvedColor] = useCSSVariable([variable]) as string[];

  return <FontAwesome6 {...props} color={color || resolvedColor} />;
}
