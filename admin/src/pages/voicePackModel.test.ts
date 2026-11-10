import { describe, expect, it } from 'vitest';
import {
  voicePackActions,
  voicePackManifestChecks,
  voicePackTransitionConfirmation,
} from './voicePackModel';

describe('voice pack admin model', () => {
  it('only exposes valid state transitions', () => {
    expect(voicePackActions('draft')).toEqual(['edit', 'publish']);
    expect(voicePackActions('published')).toEqual(['disable', 'revoke']);
    expect(voicePackActions('disabled')).toEqual(['publish', 'revoke']);
    expect(voicePackActions('revoked')).toEqual([]);
  });

  it('makes destructive impact explicit', () => {
    expect(voicePackTransitionConfirmation('revoke', 'warm-cn@1.0.0')).toContain('删除已安装模型');
    expect(voicePackTransitionConfirmation('publish', 'warm-cn@1.0.0')).toContain('不可原地覆盖');
  });

  it('flags unsafe manifests before submission', () => {
    expect(voicePackManifestChecks({ resources: [{ url: 'http://bad', path: '../model', sha256: 'no' }] }).every((item) => item.passed)).toBe(false);
  });

  it('requires explicit distribution, bounded resources and a declared text processor', () => {
    const safe = {
      voiceId: 'internal-cn', version: '1.0.0', distribution: 'internal-test',
      resources: [
        { url: 'https://example.com/model', path: 'model.onnx', sha256: 'a'.repeat(64), bytes: 1024 },
        { url: 'https://example.com/map', path: 'tokens.json', sha256: 'b'.repeat(64), bytes: 1024 },
      ],
      model: { textProcessor: { type: 'token-map-v1', mappingPath: 'tokens.json' } },
      license: { name: 'test', url: 'https://example.com/license', speakerAuthorization: 'record', modelNotice: 'extractable' },
    };
    expect(voicePackManifestChecks(safe).every((item) => item.passed)).toBe(true);
    expect(voicePackManifestChecks({ ...safe, distribution: undefined }).every((item) => item.passed)).toBe(false);
  });
});
