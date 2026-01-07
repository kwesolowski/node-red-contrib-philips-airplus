# Philips Air+ V3 Protocol Reference

Reverse-engineered from Philips Air+ Android app (decompiled APK).

## Device Models

### AC3737 (Carnation)

- Purifier + Humidifier combo
- Protocol version: V3 (`f13979b = 3`)
- Supports all v3 fields below

### Apollo

- Heater + Purifier
- Different mode mappings (65=High, 66=Low, 127=Fan)

## V3 Protocol Fields

All v3 fields use numeric DIDs (Device IDs) like `D03102`, `D0310C`, etc.

### Control Fields (Write)

| Field    | Type   | Values    | Description                                | Source         |
| -------- | ------ | --------- | ------------------------------------------ | -------------- |
| `D03102` | int    | `1` / `0` | Power on/off                               | g7/a.java:G0() |
| `D0310C` | int    | See modes | Mode + fan speed                           | g7/d.java:E0() |
| `D03128` | int    | `40-70`   | Target humidity (%)                        | g7/d.java:j0() |
| `D03105` | int    | `0-100`   | Display brightness (write)                 | g7/d.java:d0() |
| `D0310D` | int    | varies    | Display brightness (read/write)            | g7/y.java:c0() |
| `D0310A` | string | `"4"`     | Device mode (4=humidifier, other=purifier) | g7/d.java:C()  |

### AC3737 Mode Values (D0310C)

From `g7/d.java:E0()`:

| Value | Mode   | UI String      | Notes                |
| ----- | ------ | -------------- | -------------------- |
| `0`   | Auto   | Auto           | Automatic mode       |
| `1`   | Manual | FanSpeed1      | Manual speed level 1 |
| `2`   | Manual | FanSpeed2      | Manual speed level 2 |
| `17`  | Sleep  | ModeSleepShort | Sleep mode           |
| `18`  | Turbo  | PA_Turbo       | Turbo mode           |

**Note:** AC3737 hardware only supports 2 manual speeds. Protocol allows 1-16, but device ignores values >2.

### Sensor Fields (Read)

| Field    | Type | Values  | Description                              | Source         |
| -------- | ---- | ------- | ---------------------------------------- | -------------- |
| `D03221` | int  | `0-999` | PM2.5 (µg/m³)                            | parser.js      |
| `D03125` | int  | `0-100` | Current humidity (%)                     | parser.js      |
| `D03224` | int  | temp×10 | Temperature (divide by 10)               | g7/d.java:r2() |
| `D03120` | int  | `0-12`  | Air Quality Index                        | parser.js      |
| `D0312B` | int  | `0/1/2` | Sensor mode (0=IAI, 1=PM2.5, 2=Humidity) | g7/d.java:r2() |
| `D0310D` | int  | ?       | Display light (read)                     | g7/d.java:g1() |

### Filter Fields (Read)

| Field    | Type | Description                 | Source                 |
| -------- | ---- | --------------------------- | ---------------------- |
| `D0540E` | int  | HEPA filter remaining hours | g7/d.java:j3()         |
| `D05102` | int  | Filter status bitmap        | g7/d.java:getFilters() |
| `D0520D` | int  | Pre-filter (360h nominal)   | g7/d.java:j3()         |
| `D05213` | int  | Wick filter (2400h nominal) | g7/d.java:j3()         |

### Humidity Control

From `g7/d.java:g()`, app offers these presets:

- 40%
- 50%
- 60%
- 70% (max, labeled "HumidityMax")

Target humidity read/write uses `D03128`.

## Protocol Version Detection

From `g7/a.java:G0()`:

```java
int i10 = this.f13979b;
if (3 == i10) {
    // V3: D03102 with int 1/0
    w2("D03102", z10 ? 1 : 0);
} else if (2 == i10) {
    // V2: D03-02 with string "ON"/"OFF"
    z2("D03-02", z10 ? "ON" : "OFF");
} else {
    // V1: pwr with string "1"/"0"
    z2("pwr", z10 ? "1" : "0");
}
```

## Implementation Status

### ✅ Implemented in parser.js

- [x] Power: `D03102` (int 1/0)
- [x] Mode: `D0310C` (int, maps to auto/sleep/turbo/manual)
- [x] Target humidity: `D03128` (int 40-70)
- [x] PM2.5: `D03221`
- [x] Current humidity: `D03125`
- [x] Temperature: `D03224` (÷10)
- [x] Air quality: `D03120`
- [x] Filter remaining: `D0540E`

### ⚠️ Parser Updates Needed

- [ ] Display light: Should use `D0310D` (v3) instead of `uil` (v1)
  - Read: Try `D0310D` first, fallback to `uil`
  - Write: Use `D0310D` as integer for v3 devices

### 🔍 Not Yet Discovered / May Not Exist in V3

- **Child lock**: No v3 field found in decompiled code
  - AC3737 is premium model without physical buttons
  - May only exist in v1/v2 devices with button panels
  - Current parser uses `cl` (v1) - works for older devices
- **Water level**: Not found in AC3737 code
  - May be read-only sensor field
  - Or not applicable to this model

## Sources

- **g7/d.java** - AC3737 (Carnation) device implementation
- **g7/a.java** - Base purifier class with protocol version handling
- **g7/b.java** - Apollo (heater) device implementation
- **f7/a.java** - Device model detection and routing

## Next Steps

1. Test humidity control from Node-RED
2. Verify display light field (D03105 vs D0310D)
3. Find child lock v3 field
4. Test all modes (auto, sleep, turbo, manual 1-2)
