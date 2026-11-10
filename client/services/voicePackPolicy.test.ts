import {
  replaceVoicePackDirectory,
  tokenizeVoiceText,
  voiceBenchmarkPassed,
  voicePlaybackFinished,
  type VoicePackDirectoryOperations,
} from "./voicePackPolicy";

describe("voice pack policy", () => {
  it("uses the release performance thresholds for the current synthesis", () => {
    expect(voiceBenchmarkPassed(2_500, 1.2)).toBe(true);
    expect(voiceBenchmarkPassed(2_501, 1.2)).toBe(false);
    expect(voiceBenchmarkPassed(2_500, 1.201)).toBe(false);
  });

  it("settles playback promises after normal completion or interruption unload", () => {
    expect(voicePlaybackFinished({ isLoaded: true, didJustFinish: true })).toBe(true);
    expect(voicePlaybackFinished({ isLoaded: false })).toBe(true);
    expect(voicePlaybackFinished({ isLoaded: true, didJustFinish: false })).toBe(false);
  });

  it("keeps phoneme/token mapping separate from character tokenization", () => {
    const vocabulary = { "<bos>": 1, "<eos>": 2, "<unk>": 0, n: 3, i: 4, h: 5, ao: 6 };
    expect(tokenizeVoiceText("你好", vocabulary, { type: "token-map-v1", mappingPath: "phonemes.json" }, {
      你: ["n", "i"], 好: ["h", "ao"],
    })).toEqual([1, 3, 4, 5, 6, 2]);
  });

  it("restores the previous model when final directory replacement fails", async () => {
    const directories = new Set(["staging", "current"]);
    const operations: VoicePackDirectoryOperations = {
      info: async (uri) => ({ exists: directories.has(uri) }),
      remove: async (uri) => { directories.delete(uri); },
      move: async (from, to) => {
        if (from === "staging" && to === "current") throw new Error("injected move failure");
        directories.delete(from); directories.add(to);
      },
    };
    await expect(replaceVoicePackDirectory(operations, "staging", "current", "rollback"))
      .rejects.toThrow("injected move failure");
    expect(directories.has("current")).toBe(true);
    expect(directories.has("rollback")).toBe(false);
  });
});
