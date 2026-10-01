/**
 * Regression tests for the intake storage-availability probe.
 *
 * Production bug: `uploadIntakeFiles()` decided storage availability by checking
 * `probe.status === 404`. The probe body is deliberately invalid, so a correctly
 * functioning endpoint always answers 4xx — only an absent endpoint answers 404.
 * That check worked purely by accident while the storage functions were
 * undeployed. Deploying them made the probe return 400, the guard was bypassed,
 * and every customer who attached a file was stopped by the validation error
 * before they could reach payment.
 *
 * `uploadIntakeFiles` lives inside an IIFE in public/intake.js and cannot be
 * imported, so the function is lifted out of the real source and evaluated with
 * its dependencies injected. Testing the extracted real function (rather than a
 * copy) is the point: a copy would not catch a regression in the real file.
 *
 * Run with: node --test scripts/intake-storage-probe.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, '..', 'public', 'intake.js'), 'utf8');
const MAX = 5 * 1024 * 1024;

/** Lift `uploadIntakeFiles` out of the real source with DOM helpers stubbed. */
function lift() {
  const fnStart = SRC.indexOf('  async function uploadIntakeFiles()');
  assert.ok(fnStart > 0, 'could not locate uploadIntakeFiles() in public/intake.js');
  const end = SRC.indexOf('\n  }', fnStart) + '\n  }'.length;

  // Include the ATTACHMENT_SKIPPED_MESSAGE const, which sits just above the
  // function, so the lifted code can resolve it.
  const constStart = SRC.lastIndexOf('const ATTACHMENT_SKIPPED_MESSAGE', fnStart);
  assert.ok(constStart > 0 && constStart < fnStart, 'could not locate ATTACHMENT_SKIPPED_MESSAGE');

  const body = SRC
    .slice(constStart, end)
    .replace(/showNotice\(ATTACHMENT_SKIPPED_MESSAGE\);/g, 'notice(ATTACHMENT_SKIPPED_MESSAGE);')
    .replace(/clearNotice\(\);/g, 'notice(null);');

  return new Function(
    'fetch',
    'formData',
    'MAX_INTAKE_FILE_BYTES',
    'uploadOneFile',
    'console',
    'notice',
    `${body}\nreturn uploadIntakeFiles;`,
  );
}

/** Build a runnable uploadIntakeFiles with fakes injected. */
function setup({ fetchImpl, uploadOneFile, formData }) {
  const notices = [];
  const logs = [];
  const fn = lift()(
    fetchImpl,
    formData,
    MAX,
    uploadOneFile || (async () => 'file_123'),
    { warn: (m) => logs.push(m), log: () => {}, error: () => {} },
    // `notice(null)` is how the lifted source calls clearNotice(); only real
    // messages count as notices.
    (msg) => {
      if (msg != null) notices.push(msg);
    },
  );
  return { fn, notices, logs };
}

function formWith(files) {
  return {
    logo: null,
    photos: files,
    storageFileIds: [],
    intakeSessionId: null,
    attachmentsSkipped: false,
  };
}

const okProbe = async () => ({ ok: true, status: 204, json: async () => ({}) });
const failProbe = (status) => async () => ({ ok: false, status, json: async () => ({ error: 'nope' }) });

describe('source guards', () => {
  it('must not gate availability on 404', () => {
    assert.ok(
      !/probe\.status\s*===\s*404/.test(SRC),
      'public/intake.js regressed: availability must not be gated on probe.status === 404',
    );
  });

  it('must gate availability on !probe.ok', () => {
    assert.ok(/if\s*\(!probe\.ok\)/.test(SRC), 'public/intake.js must gate on !probe.ok');
  });
});

describe('attachments unavailable: purchase must still proceed', () => {
  // Each of these used to either throw (blocking the customer) or be mistaken
  // for a healthy endpoint.
  for (const [label, impl] of [
    ['storage answers 400 to the invalid probe (the live regression)', failProbe(400)],
    ['storage answers 401', failProbe(401)],
    ['storage answers 403', failProbe(403)],
    ['storage answers 404 (endpoint absent)', failProbe(404)],
    ['storage answers 429 (throttled)', failProbe(429)],
    ['storage answers 500', failProbe(500)],
    ['storage answers 503 (not configured)', failProbe(503)],
    ['storage is unreachable', async () => { throw new TypeError('fetch failed'); }],
  ]) {
    it(`continues to payment when ${label}`, async () => {
      const formData = formWith([{ name: 'logo.png', size: 100, type: 'image/png' }]);
      const uploadOneFile = async () => {
        throw new Error('must not attempt an upload when storage is unavailable');
      };
      const { fn, notices } = setup({ fetchImpl: impl, uploadOneFile, formData });

      // Resolving is the whole assertion: throwing is what blocked the sale.
      await fn();

      assert.equal(formData.attachmentsSkipped, true, 'must record that attachments were skipped');
      assert.deepEqual(formData.storageFileIds, [], 'must not invent file ids');
      assert.equal(notices.length, 1, 'customer must be told their files were not attached');
      assert.match(notices[0], /could not upload your files/i);
      assert.match(notices[0], /continue to payment/i);
    });
  }
});

describe('storage healthy', () => {
  it('attaches the files and does not show a notice', async () => {
    const formData = formWith([{ name: 'logo.png', size: 100, type: 'image/png' }]);
    const { fn, notices } = setup({ fetchImpl: okProbe, uploadOneFile: async () => 'file_123', formData });

    await fn();

    assert.deepEqual(formData.storageFileIds, ['file_123']);
    assert.equal(formData.attachmentsSkipped, false);
    assert.equal(notices.length, 0);
  });

  it('deduplicates repeated file ids', async () => {
    const formData = formWith([
      { name: 'a.png', size: 10, type: 'image/png' },
      { name: 'b.png', size: 10, type: 'image/png' },
    ]);
    const { fn } = setup({ fetchImpl: okProbe, uploadOneFile: async () => 'same_id', formData });
    await fn();
    assert.deepEqual(formData.storageFileIds, ['same_id']);
  });

  it('rejects an oversized file with a clear error', async () => {
    const formData = formWith([{ name: 'huge.png', size: 6 * 1024 * 1024, type: 'image/png' }]);
    const { fn } = setup({ fetchImpl: okProbe, uploadOneFile: async () => 'x', formData });
    await assert.rejects(fn, /5MB limit/);
  });
});

describe('no attachments', () => {
  it('does not probe storage at all', async () => {
    const formData = formWith([]);
    let probed = false;
    const { fn } = setup({
      fetchImpl: async () => {
        probed = true;
        return { ok: false, status: 503 };
      },
      uploadOneFile: async () => 'x',
      formData,
    });
    await fn();
    assert.equal(probed, false, 'must not probe when there is nothing to upload');
    assert.equal(formData.attachmentsSkipped, false);
  });
});

describe('downstream honesty', () => {
  it('payment.js records attachmentsSkipped on the order', () => {
    const pay = readFileSync(join(here, '..', 'public', 'payment.js'), 'utf8');
    assert.ok(
      /attachmentsSkipped:\s*formData\.attachmentsSkipped\s*===\s*true/.test(pay),
      'payment.js must forward attachmentsSkipped so fulfilment knows to chase the files',
    );
  });
});
