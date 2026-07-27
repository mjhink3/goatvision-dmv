// MDOT SHA CHART live speed-sensor feed (chart.maryland.gov/DataFeeds/GetTssXml).
// Confirmed live via direct recon: 296 physical sensors statewide, XML format, no CORS
// header (Access-Control-Allow-Origin absent — confirmed via curl -I), so this cannot be
// fetched client-side and must be proxied server-side, same as the HERE pipeline below.
//
// The feed reports a chronic ~42% failure rate at any given time (confirmed live: 123 of
// 296 sensors COMM_FAILURE, 2 HARDWARE_FAILURE), and a dead sensor's speed reads as -1, not
// 0 or null — a naive integration would misrepresent -1 as near-zero/stopped traffic if not
// filtered. Worse, opStatus alone isn't reliable either: a real sensor was found reporting
// commMode=OFFLINE, opStatus=OK (frozen from before it dropped comms), zone speed -1, and a
// last-update timestamp 344 minutes old — opStatus can be stale as well as the reading it
// describes. A row only gets written here if it passes ALL of:
//   1. commMode === 'ONLINE'
//   2. opStatus === 'OK'
//   3. reading age <= STALE_MS (confirmed OK-sensor average age is ~5min; 20min is a safe margin)
//   4. zone speed is a plausible reading (see isPlausibleSpeed below)
const STALE_MS = 20 * 60 * 1000;

// -1 is the confirmed "sensor has no reading" sentinel (178 occurrences in one live pull,
// always exactly -1, never any other negative). But a live pull also surfaced SIX distinct
// garbage-high values in the same "no valid reading" category as -1, not just the one we
// happened to catch first: 65535 (0xFFFF, unsigned 16-bit overflow) and five more clustered
// tightly around 32768/0x8000 (32785, 32795, 32798, 32800, 32801 — a 16-bit "high bit set"
// error-flag family) plus one further outlier (43712). These aren't one fixed constant, so
// hardcoding only the ones seen so far would miss the next variant in the same neighborhood.
// KNOWN_SENTINEL_SPEEDS documents the specific values actually observed; the plausibility
// range below is what actually does the catching, including for values not on this list.
const KNOWN_SENTINEL_SPEEDS = new Set([-1, 65535, 43712, 32785, 32795, 32798, 32800, 32801]);
// Upper bound deliberately generous — max real speed seen live is 95mph — so this only ever
// kills obvious garbage (the lowest garbage value seen, ~32785, is 273x this bound) and never
// a legitimately fast free-flow reading in the high-80s/90s.
const MIN_PLAUSIBLE_MPH = 0;
const MAX_PLAUSIBLE_MPH = 120;
function isPlausibleSpeed(speed) {
  if (speed == null || Number.isNaN(speed)) return false;
  if (KNOWN_SENTINEL_SPEEDS.has(speed)) return false;
  return speed >= MIN_PLAUSIBLE_MPH && speed <= MAX_PLAUSIBLE_MPH;
}

function parseSensors(xml) {
  const sensorBlocks = xml.match(/<SpeedSensor>[\s\S]*?<\/SpeedSensor>/g) || [];
  return sensorBlocks.map(block => {
    // Pull zones out first so their nested <speed>/<bearing> tags don't collide with the
    // sensor's own top-level tags of the same name (this bit me during recon: the top-level
    // <speed> is always "0" and unrelated to the real per-direction speed inside <zones>).
    const zoneBlocks = [...block.matchAll(/<zones>([\s\S]*?)<\/zones>/g)].map(z => z[1]);
    const topLevel = block.replace(/<zones>[\s\S]*?<\/zones>/g, '');
    const field = (src, name) => (src.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1];

    const sensor = {
      id: field(topLevel, 'id'),
      description: field(topLevel, 'description'),
      lat: parseFloat(field(topLevel, 'lat')),
      lon: parseFloat(field(topLevel, 'lon')),
      opStatus: field(topLevel, 'opStatus'),
      commMode: field(topLevel, 'commMode'),
      lastUpdateTime: parseInt(field(topLevel, 'lastUpdateTime'), 10),
    };
    sensor.zones = zoneBlocks.map(z => ({
      bearing: parseInt(field(z, 'bearing'), 10),
      direction: field(z, 'direction'),
      speed: parseInt(field(z, 'speed'), 10),
    }));
    return sensor;
  });
}

export default async function handler(req, res) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const response = await fetch('https://chart.maryland.gov/DataFeeds/GetTssXml');
    if (!response.ok) throw new Error(`CHART TSS request failed: HTTP ${response.status}`);
    const xml = await response.text();

    const sensors = parseSensors(xml);
    const now = Date.now();
    const rows = [];
    // Every exclusion reason counted the same way, so a sentinel reading is dropped
    // visibly (in the response + function logs), not silently alongside an aggregate
    // written-vs-total number that hides why anything didn't make it.
    const excluded = { unhealthy: 0, stale: 0, implausibleSpeed: 0 };

    for (const s of sensors) {
      if (s.commMode !== 'ONLINE' || s.opStatus !== 'OK') { excluded.unhealthy++; continue; }
      if (!s.lastUpdateTime || now - s.lastUpdateTime > STALE_MS) { excluded.stale++; continue; }
      for (const z of s.zones) {
        if (!isPlausibleSpeed(z.speed)) { excluded.implausibleSpeed++; continue; }
        rows.push({
          sensor_id: s.id,
          direction: z.direction,
          description: s.description,
          bearing: z.bearing,
          lat: s.lat,
          lon: s.lon,
          speed_mph: z.speed,
          sensor_updated_at: new Date(s.lastUpdateTime).toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    console.log(`[cron-md-tss] sensors=${sensors.length} written=${rows.length} excluded=${JSON.stringify(excluded)}`);

    if (!rows.length) {
      return res.status(200).json({ ok: true, written: 0, totalSensors: sensors.length, excluded });
    }

    const upsertRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/md_tss_snapshot?on_conflict=sensor_id,direction`,
      {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
      }
    );
    if (!upsertRes.ok) throw new Error(`Supabase upsert failed: HTTP ${upsertRes.status}`);

    res.status(200).json({ ok: true, written: rows.length, totalSensors: sensors.length, excluded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
