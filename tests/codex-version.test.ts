import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexVersion } from '../src/shared/codex-version.ts';
import { verifyCodexVersion } from '../src/main/codex-policy.ts';

test('version recognition preserves the exact tested stable or prerelease version', () => {
  for (const version of ['0.153.4', '0.154.0-alpha.6.2']) {
    assert.equal(codexVersion(`Warning before version\ncodex-cli ${version}\n`, 'cli'), version);
    assert.equal(verifyCodexVersion(`modern_codex_editor/${version} (test host)`), version);
  }
});
test('nearby releases, altered prereleases and malformed version strings cannot bypass the policy', () => {
  for (const version of ['0.154.0', '0.154.0-alpha.6.1', '0.154.0-alpha.6.3', '0.153.4-alpha.1', '0.154.0-alpha.6.2.extra', '0.154.0-alpha.6.2/extra', '0.153.4+unverified']) {
    assert.throws(() => verifyCodexVersion(`modern_codex_editor/${version}`), /No paper text was sent/);
  }
  for (const value of [null, {}, 'other_client/0.153.4', 'modern_codex_editor/0.154.0-alpha..6.2']) assert.throws(() => verifyCodexVersion(value), /No paper text was sent/);
  assert.throws(() => verifyCodexVersion('modern_codex_editor/0.155.0'), /Detected Codex CLI 0\.155\.0.*Setup/);
});
