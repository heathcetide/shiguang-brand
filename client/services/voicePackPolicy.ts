export const MAX_VOICE_PACK_RESOURCE_BYTES = 200 * 1024 * 1024;
export const MAX_VOICE_PACK_TOTAL_BYTES = 350 * 1024 * 1024;
export const MAX_FIRST_AUDIO_MS = 2_500;
export const MAX_REALTIME_FACTOR = 1.2;

type TextProcessor =
  | { type: "character-v1" }
  | { type: "token-map-v1"; mappingPath: string };

export function voiceBenchmarkPassed(firstAudioMs: number, realtimeFactor: number) {
  return firstAudioMs <= MAX_FIRST_AUDIO_MS && realtimeFactor <= MAX_REALTIME_FACTOR;
}

export function voicePlaybackFinished(status: { isLoaded: boolean; didJustFinish?: boolean }) {
  return !status.isLoaded || status.didJustFinish === true;
}

export function tokenizeVoiceText(
  text: string,
  vocabulary: Record<string, number>,
  processor: TextProcessor = { type: "character-v1" },
  tokenMap: Record<string, string[]> = {},
) {
  const normalized = text.normalize("NFKC");
  const tokens = processor.type === "token-map-v1"
    ? [...normalized].flatMap((character) => tokenMap[character] || ["<unk>"])
    : [...normalized];
  const unknown = vocabulary["<unk>"] ?? 0;
  const start = vocabulary["<bos>"];
  const end = vocabulary["<eos>"];
  return [
    ...(start === undefined ? [] : [start]),
    ...tokens.map((token) => vocabulary[token] ?? unknown),
    ...(end === undefined ? [] : [end]),
  ];
}

type DirectoryInfo = { exists: boolean };
export type VoicePackDirectoryOperations = {
  info(uri: string): Promise<DirectoryInfo>;
  remove(uri: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
};

/** Swaps a fully verified staging directory while retaining a rollback copy. */
export async function replaceVoicePackDirectory(
  operations: VoicePackDirectoryOperations,
  staging: string,
  destination: string,
  rollback: string,
) {
  const [destinationInfo, rollbackInfo] = await Promise.all([
    operations.info(destination),
    operations.info(rollback),
  ]);
  if (!destinationInfo.exists && rollbackInfo.exists) {
    await operations.move(rollback, destination);
  } else if (destinationInfo.exists && rollbackInfo.exists) {
    await operations.remove(rollback);
  }

  const current = await operations.info(destination);
  if (current.exists) await operations.move(destination, rollback);
  try {
    await operations.move(staging, destination);
  } catch (error) {
    if ((await operations.info(rollback)).exists && !(await operations.info(destination)).exists) {
      await operations.move(rollback, destination);
    }
    throw error;
  }
  await operations.remove(rollback).catch(() => undefined);
}
