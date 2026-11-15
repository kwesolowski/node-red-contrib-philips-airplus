/**
 * Jest globalSetup: points HOME at an empty directory, so no test reads or writes the real
 * ~/.philips-airplus/credentials.json. It runs in the parent process; setupFiles would only
 * change the test sandbox's copy of process.env, which os.homedir() does not read.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = () => {
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'airplus-test-home-'));
};
