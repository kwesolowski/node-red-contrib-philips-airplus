/**
 * Jest globalSetup: points HOME at an empty directory, so no test reads or writes the real
 * ~/.philips-airplus/credentials.json. It runs in the parent process; setupFiles would only
 * change the test sandbox's copy of process.env, which os.homedir() does not read.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'airplus-test-home-'));
  // globalTeardown runs in this same parent process and reads it to delete the dir
  process.env.AIRPLUS_TEST_HOME = home;
  process.env.HOME = home;
  // os.homedir() reads USERPROFILE on Windows
  process.env.USERPROFILE = home;
};
