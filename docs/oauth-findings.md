# OAuth Token Management Findings

Analysis of Philips Air+ Android app (v3.16.1) decompiled with jadx.

## Token Structure (PHAccount.java)

```
- user_id (f3515a)
- token_type (f3516b)
- refresh_token (f3517c) - RT
- access_token (f3518d) - AT
- id_token (f3519e) - IT
- expires (f3524j) - milliseconds timestamp
```

The `expires` field is calculated from `expires_in` (access token lifetime, ~1 hour):
```java
this.f3524j = System.currentTimeMillis() + (jSONObject.optLong("expires_in") * 1000);
```

Refresh token validity is server-side (SAP CDC), not stored locally.

## Refresh Buffer

`JConstants.MIN = 60000` (1 minute)

Token refresh triggered when: `expires - now <= 60000ms`

## Key Difference: Refresh Request Params

Mobile app sends **both tokens** in refresh request (OneIdAuth.java:782-793):

```java
sb.append("&grant_type=refresh_token");
sb.append("&refresh_token=");
sb.append(URLEncoder.encode(str2, "utf-8"));
sb.append("&access_token=");
sb.append(URLEncoder.encode(str, "utf-8"));
```

Standard OAuth2 only requires `refresh_token`. SAP CDC may require access_token to bind/validate the session.

## Thread Safety

Mobile app uses:
1. `synchronized` keyword on refresh methods (OneIdAuth.java:625)
2. Mutex in HTTP interceptor (ClientAuthenticationInterceptor.java:49)

This prevents concurrent refresh attempts that could invalidate tokens.

## Token Storage

Tokens stored in SQLite database (c0.java:185-196):
- user_id, access_token, id_token, refresh_token, expires
- All encrypted with `l6.a.c()` before storage

## Authentication States (UserAuthenticationState.java)

```java
SIGNED_IN
SIGNED_OUT
SIGNED_OUT_FEDERATED_TOKEN_INVALID  // Specific handling for invalid tokens
UNKNOWN
```

## Recommendations

1. **Add mutex** to prevent concurrent token refresh
2. **Consider sending access_token** in refresh request (non-standard but may be required)
3. **Store both tokens** and update atomically
4. **Implement background refresh** before expiry (proactive, not reactive)

## Source Files

Decompiled from APK at `/tmp/philips-jadx/sources/`:
- `com/airmatters/oneid/OneIdAuth.java` - OAuth flow
- `com/airmatters/oneid/PHAccount.java` - Token model
- `com/philips/cl/daconnect/authentication/ClientAuthenticationInterceptor.java` - HTTP interceptor with mutex
- `com/philips/ph/homecare/bean/c0.java` - Database storage
