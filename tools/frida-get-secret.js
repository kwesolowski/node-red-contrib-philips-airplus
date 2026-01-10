// Frida script to extract the secret key
Java.perform(function () {
  console.log('[*] Hooking l6.a.e() to get decrypted secret...');

  var CryptoClass = Java.use('l6.a');

  // Hook the static e() method
  CryptoClass.e.implementation = function (input) {
    var result = this.e(input);
    console.log('[SECRET] Input: ' + input);
    console.log('[SECRET] Decrypted: ' + result);
    return result;
  };

  // Also hook setSecret to see what value is set
  var HttpRequestManager = Java.use('com.gaoda.sdk.http.HttpRequestManager');
  HttpRequestManager.setSecret.implementation = function (secret) {
    console.log('[SECRET] HttpRequestManager.setSecret called with: ' + secret);
    this.setSecret(secret);
  };

  // Hook the signature generation
  var HMACSHA256Utils = Java.use('com.gaoda.util.HMACSHA256Utils');
  HMACSHA256Utils.sha256_HMAC.implementation = function (data, key) {
    var result = this.sha256_HMAC(data, key);
    console.log('[HMAC] data: ' + data);
    console.log('[HMAC] key: ' + key);
    console.log('[HMAC] result: ' + result);
    return result;
  };

  console.log('[*] Hooks installed, waiting for app to use encryption...');
});
