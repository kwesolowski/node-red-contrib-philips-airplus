// Comprehensive SSL pinning bypass for Android
// Based on multiple community scripts

Java.perform(function () {
  console.log('[*] Starting comprehensive SSL bypass...');

  // 1. SSLContext.init bypass
  try {
    var TrustManager = Java.registerClass({
      name: 'com.bypass.TrustManager',
      implements: [Java.use('javax.net.ssl.X509TrustManager')],
      methods: {
        checkClientTrusted: function (chain, authType) {},
        checkServerTrusted: function (chain, authType) {},
        getAcceptedIssuers: function () {
          return [];
        },
      },
    });

    var SSLContext = Java.use('javax.net.ssl.SSLContext');
    SSLContext.init.overload(
      '[Ljavax.net.ssl.KeyManager;',
      '[Ljavax.net.ssl.TrustManager;',
      'java.security.SecureRandom'
    ).implementation = function (km, tm, sr) {
      console.log('[+] Bypassing SSLContext.init');
      this.init(km, [TrustManager.$new()], sr);
    };
    console.log('[+] SSLContext.init bypass installed');
  } catch (e) {
    console.log('[-] SSLContext bypass failed: ' + e);
  }

  // 2. TrustManagerImpl bypass (Android 7+)
  try {
    var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');
    TrustManagerImpl.verifyChain.implementation = function (
      untrustedChain,
      trustAnchorChain,
      host,
      clientAuth,
      ocspData,
      tlsSctData
    ) {
      console.log('[+] TrustManagerImpl.verifyChain bypass for: ' + host);
      return untrustedChain;
    };
    console.log('[+] TrustManagerImpl bypass installed');
  } catch (e) {
    console.log('[-] TrustManagerImpl bypass failed: ' + e);
  }

  // 3. OkHttp3 CertificatePinner bypass
  try {
    var CertificatePinner = Java.use('okhttp3.CertificatePinner');
    CertificatePinner.check.overload('java.lang.String', 'java.util.List').implementation =
      function (hostname, peerCertificates) {
        console.log('[+] OkHttp3 CertificatePinner.check bypass for: ' + hostname);
      };
    console.log('[+] OkHttp3 CertificatePinner bypass installed');
  } catch (e) {
    console.log('[-] OkHttp3 CertificatePinner bypass failed: ' + e);
  }

  // 4. OkHttp3 CertificatePinner$Builder.add bypass
  try {
    var Builder = Java.use('okhttp3.CertificatePinner$Builder');
    Builder.add.overload('java.lang.String', '[Ljava.lang.String;').implementation = function (
      hostname,
      pins
    ) {
      console.log('[+] OkHttp3 CertificatePinner.Builder.add bypass for: ' + hostname);
      return this;
    };
    console.log('[+] OkHttp3 CertificatePinner$Builder bypass installed');
  } catch (e) {
    console.log('[-] OkHttp3 CertificatePinner$Builder bypass failed: ' + e);
  }

  // 5. HttpsURLConnection setDefaultSSLSocketFactory bypass
  try {
    var HttpsURLConnection = Java.use('javax.net.ssl.HttpsURLConnection');
    HttpsURLConnection.setDefaultSSLSocketFactory.implementation = function (factory) {
      console.log('[+] HttpsURLConnection.setDefaultSSLSocketFactory bypass');
    };
    console.log('[+] HttpsURLConnection bypass installed');
  } catch (e) {
    console.log('[-] HttpsURLConnection bypass failed: ' + e);
  }

  // 6. Network Security Config bypass for Android 7+
  try {
    var NetworkSecurityConfig = Java.use('android.security.net.config.NetworkSecurityConfig');
    NetworkSecurityConfig.isCleartextTrafficPermitted.overload().implementation = function () {
      console.log('[+] NetworkSecurityConfig.isCleartextTrafficPermitted bypass');
      return true;
    };
    console.log('[+] NetworkSecurityConfig bypass installed');
  } catch (e) {
    console.log('[-] NetworkSecurityConfig bypass failed: ' + e);
  }

  // 7. RootedDeviceCheck / TrustManagerFactory bypass
  try {
    var TrustManagerFactory = Java.use('javax.net.ssl.TrustManagerFactory');
    TrustManagerFactory.getTrustManagers.implementation = function () {
      console.log('[+] TrustManagerFactory.getTrustManagers bypass');
      var TrustManagerImpl = Java.registerClass({
        name: 'com.bypass.TrustManager2',
        implements: [Java.use('javax.net.ssl.X509TrustManager')],
        methods: {
          checkClientTrusted: function (chain, authType) {},
          checkServerTrusted: function (chain, authType) {},
          getAcceptedIssuers: function () {
            return [];
          },
        },
      });
      return [TrustManagerImpl.$new()];
    };
    console.log('[+] TrustManagerFactory bypass installed');
  } catch (e) {
    console.log('[-] TrustManagerFactory bypass failed: ' + e);
  }

  // 8. Conscrypt Hostname verification bypass
  try {
    var ConscryptHostnameVerifier = Java.use('com.android.org.conscrypt.Platform');
    ConscryptHostnameVerifier.checkServerTrusted.overload(
      'javax.net.ssl.X509TrustManager',
      '[Ljava.security.cert.X509Certificate;',
      'java.lang.String',
      'com.android.org.conscrypt.AbstractConscryptSocket'
    ).implementation = function (tm, chain, authType, socket) {
      console.log('[+] Conscrypt Platform.checkServerTrusted bypass');
      return Java.use('java.util.ArrayList').$new();
    };
    console.log('[+] Conscrypt bypass installed');
  } catch (e) {
    console.log('[-] Conscrypt bypass failed: ' + e);
  }

  // 9. HostnameVerifier bypass
  try {
    var HostnameVerifier = Java.use('javax.net.ssl.HostnameVerifier');
    var SSLSession = Java.use('javax.net.ssl.SSLSession');

    var HttpsURLConnection2 = Java.use('javax.net.ssl.HttpsURLConnection');
    HttpsURLConnection2.setDefaultHostnameVerifier.implementation = function (verifier) {
      console.log('[+] HttpsURLConnection.setDefaultHostnameVerifier bypass');
    };
    HttpsURLConnection2.setHostnameVerifier.implementation = function (verifier) {
      console.log('[+] HttpsURLConnection.setHostnameVerifier bypass');
    };
    console.log('[+] HostnameVerifier bypass installed');
  } catch (e) {
    console.log('[-] HostnameVerifier bypass failed: ' + e);
  }

  // 10. WebView SSL Error bypass
  try {
    var WebViewClient = Java.use('android.webkit.WebViewClient');
    WebViewClient.onReceivedSslError.implementation = function (
      webView,
      sslErrorHandler,
      sslError
    ) {
      console.log('[+] WebViewClient.onReceivedSslError bypass');
      sslErrorHandler.proceed();
    };
    console.log('[+] WebViewClient bypass installed');
  } catch (e) {
    console.log('[-] WebViewClient bypass failed: ' + e);
  }

  console.log('[*] Comprehensive SSL bypass loaded');
});
