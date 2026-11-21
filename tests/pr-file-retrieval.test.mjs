import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const imports = "import core from '@actions/core';\nimport github from '@actions/github';\n";
assert.ok(source.startsWith(imports));
// Execute the real action with injected imports, without loading SDKs or credentials.
const action = new vm.Script(source.slice(imports.length), { filename: 'src/index.js' });

async function runAction(files, excludePaths = '') {
  const owner = 'test-owner';
  const repo = 'test-repo';
  const prNumber = 42;
  const headSha = '0123456789abcdef0123456789abcdef01234567';
  const code = 'contract ChangedContract {}';
  const report = '## LOW\nMock audit report';
  const calls = { list: [], content: [], fetch: [], comments: [], errors: [], failures: [], info: [] };
  const inputs = {
    'github-token': 'offline-github-token',
    'api-key': 'offline-api-key',
    'api-provider': 'openai',
    'exclude-paths': excludePaths,
  };
  const core = {
    getInput: name => inputs[name] || '',
    info: message => calls.info.push(message),
    error: message => calls.errors.push(message),
    setFailed: message => calls.failures.push(message),
  };
  const github = {
    context: {
      repo: { owner, repo },
      payload: { pull_request: { number: prNumber, head: { sha: headSha } } },
    },
    getOctokit(token) {
      assert.equal(token, inputs['github-token']);
      return { rest: {
        pulls: { async listFiles(args) {
          calls.list.push(args);
          return { data: files };
        } },
        repos: { async getContent(args) {
          calls.content.push(args);
          assert.ok(files.some(file => file.filename === args.path),
            `getContent must use a changed filename, received ${args.path}`);
          assert.equal(args.ref, headSha);
          return { data: { content: Buffer.from(code).toString('base64') } };
        } },
        issues: { async createComment(args) {
          calls.comments.push(args);
          return { data: {} };
        } },
      } };
    },
  };
  const fetch = async (url, options) => {
    calls.fetch.push({ url, options });
    return { ok: true, json: async () => ({ choices: [{ message: { content: report } }] }) };
  };

  await action.runInNewContext({ core, github, Buffer, fetch });
  // Objects created in the VM have different prototypes; normalize for strict comparisons.
  const recorded = JSON.parse(JSON.stringify(calls));
  assert.deepEqual(recorded.failures, []);
  assert.deepEqual(recorded.errors, []);
  assert.deepEqual(recorded.list, [{ owner, repo, pull_number: prNumber }]);
  return { calls: recorded, owner, repo, prNumber, headSha, code, report };
}

for (const file of [
  { filename: 'Token.sol', status: 'modified' },
  { filename: 'contracts/nested/Token.sol', status: 'added' },
  { filename: 'contracts/nested/Token.sol', path: 'wrong/Token.sol', status: 'modified' },
  {
    filename: 'contracts/new/Token.sol',
    previous_filename: 'contracts/old/Token.sol',
    path: 'contracts/old/Token.sol',
    status: 'renamed',
  },
]) {
  test(`retrieves and reports ${file.status} ${file.filename} (path: ${file.path})`, async () => {
    const { calls, owner, repo, prNumber, headSha, code, report } = await runAction([file]);
    assert.deepEqual(calls.content, [{ owner, repo, path: file.filename, ref: headSha }]);
    assert.equal(calls.fetch.length, 1);
    assert.equal(calls.fetch[0].options.method, 'POST');
    const prompt = JSON.parse(calls.fetch[0].options.body).messages[0].content;
    assert.ok(prompt.includes(`File to audit: ${file.filename}`));
    assert.ok(prompt.includes(code));
    assert.equal(calls.comments.length, 1);
    assert.equal(calls.comments[0].owner, owner);
    assert.equal(calls.comments[0].repo, repo);
    assert.equal(calls.comments[0].issue_number, prNumber);
    assert.ok(calls.comments[0].body.includes(`Report for \`${file.filename}\``));
    assert.ok(calls.comments[0].body.includes(report));
  });
}

test('removed, excluded, and unsupported files are skipped before retrieval or auditing', async () => {
  const { calls } = await runAction([
    { filename: 'contracts/Removed.sol', status: 'removed' },
    { filename: 'vendor/Excluded.sol', status: 'modified' },
    { filename: 'contracts/Generated.sol', status: 'added' },
    { filename: 'README.md', status: 'modified' },
  ], ' vendor/*, contracts/Generated.sol ');
  assert.deepEqual(calls.content, []);
  assert.deepEqual(calls.fetch, []);
  assert.deepEqual(calls.comments, []);
  assert.ok(calls.info.includes('Skipping excluded file: vendor/Excluded.sol'));
  assert.ok(calls.info.includes('Skipping excluded file: contracts/Generated.sol'));
});
