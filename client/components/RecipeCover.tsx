import { useState } from "react";
import { Image } from "expo-image";
import { withUniwind } from "uniwind";

const StyledImage = withUniwind(Image);
const recipeCoverPlaceholder = require("../assets/images/recipe-cover-placeholder.jpg");

interface RecipeCoverProps {
  uri?: string | null;
  className: string;
  placeholderClassName: string;
}

export function RecipeCover({
  uri,
  className,
  placeholderClassName,
}: RecipeCoverProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = Boolean(uri && failedUri === uri);

  if (!uri || failed) {
    return (
      <StyledImage
        source={recipeCoverPlaceholder}
        className={placeholderClassName}
        contentFit="cover"
        accessible={false}
      />
    );
  }

  return (
    <StyledImage
      source={{ uri }}
      className={className}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={180}
      onError={() => setFailedUri(uri || null)}
    />
  );
}
