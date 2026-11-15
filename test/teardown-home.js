/**
 * Jest globalTeardown: deletes the temporary HOME that test/setup-home.js made.
 * Both run in the parent process, so the path comes from process.env.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = () => {
  const home = process.env.AIRPLUS_TEST_HOME;
  const prefix = path.join(os.tmpdir(), 'airplus-test-home-');
  if (!home || !home.startsWith(prefix)) {
    throw new Error(`AIRPLUS_TEST_HOME is not a test home under ${prefix}: ${home}`);
  }
  fs.rmSync(home, { recursive: true, force: true });
};
