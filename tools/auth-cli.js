#!/usr/bin/env node
/**
 * Philips Air+ Authentication CLI
 *
 * Run this once to get your tokens:
 *   npx philips-airplus-auth
 *
 * Or from the package directory:
 *   node tools/auth-cli.js
 */

const crypto = require('crypto');
const http = require('http');
const { exec } = require('child_process');
const readline = require('readline');

const OIDC_TOKEN_URL = 'https://cdc.accounts.home.id/oidc/op/v1.0/4_JGZWlP8eQHpEqkvQElolbA/token';
const OIDC_CLIENT_ID = '-XsK7O6iEkLml77yDGDUi0ku';
const OIDC_REDIRECT_URI = 'com.philips.air://loginredirect';

function generatePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildAuthUrl(challenge, state) {
  const params = new URLSearchParams({
    client_id: OIDC_CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: OIDC_REDIRECT_URI,
    ui_locales: 'en-US',
    state: state,
    nonce: crypto.randomBytes(8).toString('hex'),
    scope:
      'openid email profile address DI.Account.read DI.Account.write DI.AccountProfile.read DI.AccountProfile.write DI.AccountGeneralConsent.read DI.AccountGeneralConsent.write DI.GeneralConsent.read subscriptions profile_extended consents DI.AccountSubscription.read DI.AccountSubscription.write',
  });
  return `https://cdc.accounts.home.id/oidc/op/v1.0/4_JGZWlP8eQHpEqkvQElolbA/authorize?${params.toString()}`;
}

function parseRedirectUrl(input) {
  const raw = input.trim().replace(/^["']|["']$/g, '');
  const codeMatch = raw.match(/[?&]code=([^&]+)/);
  if (codeMatch) {
    return decodeURIComponent(codeMatch[1]);
  }
  if (raw.match(/^st\d+\./)) {
    return raw.split('&')[0];
  }
  return null;
}

async function exchangeCode(code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: OIDC_REDIRECT_URI,
    client_id: OIDC_CLIENT_ID,
    code_verifier: verifier,
  });

  const response = await fetch(OIDC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${text}`);
  }

  return response.json();
}

function openUrl(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = q => new Promise(resolve => rl.question(q, resolve));

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║          Philips Air+ Authentication Helper                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const { verifier, challenge } = generatePkce();
  const state = crypto.randomBytes(8).toString('hex');
  const authUrl = buildAuthUrl(challenge, state);

  console.log('Step 1: Opening your browser for Philips login...\n');
  openUrl(authUrl);

  console.log('Step 2: After logging in, your browser will try to redirect to');
  console.log('        "com.philips.air://..." which will FAIL (that\'s OK!).\n');
  console.log("Step 3: Copy the ENTIRE URL from your browser's address bar");
  console.log('        (or from the error message if shown).\n');

  console.log('─'.repeat(60));
  const redirectUrl = await question('\nPaste the redirect URL here:\n> ');

  const code = parseRedirectUrl(redirectUrl);
  if (!code) {
    console.error('\n❌ Could not extract authorization code from that URL.');
    console.log('   Make sure you copied the full URL containing "code=..."');
    rl.close();
    process.exit(1);
  }

  console.log('\n⏳ Exchanging code for tokens...');

  try {
    const tokens = await exchangeCode(code, verifier);

    console.log('\n✅ Authentication successful!\n');
    console.log('─'.repeat(60));
    console.log('\nCopy these values into your Node-RED config:\n');
    console.log('ACCESS TOKEN:');
    console.log(tokens.access_token);
    console.log('\nREFRESH TOKEN:');
    console.log(tokens.refresh_token);
    console.log('\nEXPIRES AT (timestamp):');
    console.log(Date.now() + tokens.expires_in * 1000);
    console.log('\n─'.repeat(60));

    // Save to file for convenience
    const fs = require('fs');
    const outputFile = 'philips-airplus-tokens.json';
    fs.writeFileSync(
      outputFile,
      JSON.stringify(
        {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
        },
        null,
        2
      )
    );
    console.log(`\nTokens also saved to: ${outputFile}`);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    rl.close();
    process.exit(1);
  }

  rl.close();
}

main();
