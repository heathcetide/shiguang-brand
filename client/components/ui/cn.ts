import { cnMerge, type CnOptions } from 'tailwind-variants';

/** Merge Uniwind/Tailwind class names with conflict resolution. */
export function cn(...args: CnOptions) {
  return cnMerge(args)({
    twMerge: true,
    twMergeConfig: {
      classGroups: {
        opacity: [{ opacity: ['disabled'] }],
      },
    },
  });
}
