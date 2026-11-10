import { BaseCallbackHandler } from "@langchain/core/callbacks/base";

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** Decodes only the complete prefix of the JSON `reply` string. */
export class StructuredReplyDecoder {
  private source = "";
  private emittedLength = 0;

  push(chunk: string) {
    this.source += chunk;
    const match = /"reply"\s*:\s*"/.exec(this.source);
    if (!match) return "";

    let decoded = "";
    const start = match.index + match[0].length;
    for (let index = start; index < this.source.length; index += 1) {
      const character = this.source[index]!;
      if (character === '"') break;
      if (character !== "\\") {
        decoded += character;
        continue;
      }

      const escape = this.source[index + 1];
      if (!escape) break;
      if (escape === "u") {
        const hex = this.source.slice(index + 2, index + 6);
        if (hex.length < 4) break;
        if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error("Agent streamed invalid JSON unicode escape");
        decoded += String.fromCharCode(Number.parseInt(hex, 16));
        index += 5;
        continue;
      }
      if (!(escape in SIMPLE_ESCAPES)) throw new Error("Agent streamed invalid JSON escape");
      decoded += SIMPLE_ESCAPES[escape];
      index += 1;
    }

    const delta = decoded.slice(this.emittedLength);
    this.emittedLength = decoded.length;
    return delta;
  }
}

export class StructuredReplyStreamHandler extends BaseCallbackHandler {
  name = "realtime_structured_reply_stream";
  readonly lc_prefer_streaming = true;
  private decoder = new StructuredReplyDecoder();
  private pending = "";
  private readonly sink: (delta: string) => Promise<void> | void;

  constructor(sink: (delta: string) => Promise<void> | void) {
    super({ _awaitHandler: true, raiseError: true });
    this.sink = sink;
  }

  async handleLLMNewToken(token: string) {
    this.pending += this.decoder.push(token);
    await this.flush(false);
  }

  async handleLLMEnd() {
    await this.flush(true);
  }

  private async flush(final: boolean) {
    while (this.pending) {
      const punctuation = this.pending.search(/[。！？!?；;\n]/);
      const boundedPrefix = Array.from(this.pending).slice(0, 18).join("");
      const length = punctuation >= 0 ? punctuation + 1
        : Array.from(this.pending).length >= 18 ? boundedPrefix.length
          : final ? this.pending.length : 0;
      if (!length) return;
      const delta = this.pending.slice(0, length);
      this.pending = this.pending.slice(length);
      if (delta) await this.sink(delta);
    }
  }
}
