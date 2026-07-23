// Proxies WMATA API calls, injecting the key server-side. Client passes the relative
// WMATA path (e.g. "Incidents.svc/json/Incidents" or
// "StationPrediction.svc/json/GetPrediction/A01") as ?path=, checked against an allowlist
// so this can't be used as an open relay for arbitrary hosts/paths.
const ALLOWED = [
  /^Incidents\.svc\/json\/Incidents$/,
  /^Incidents\.svc\/json\/BusIncidents$/,
  /^StationPrediction\.svc\/json\/GetPrediction\/[A-Za-z0-9]+$/,
  /^TrainPositions\/StandardRoutes(\?.*)?$/,
  /^TrainPositions\/TrainPositions(\?.*)?$/,
  // Real-time bus arrival predictions — confirmed genuinely live via GPS (re-querying the
  // same stop showed the countdown for the same real VehicleID tick down over time), not
  // schedule data. WMATA's casing is inconsistent between services, hence case-insensitive.
  // Not yet wired to the Metrobus panel — see METROBUS_SCHEDULES comment in index.html for why.
  /^NextBusService\.svc\/json\/jPredictions(\?.*)?$/i,
  // Temporary — re-sourcing real StopIDs for the corrected route mapping (D20, D24, D94,
  // C13, C17, C23, D1X, D4X, C51, C57, D32, D34, D6X, D80). Remove once captured.
  /^gtfs\/bus-gtfs-static\.zip$/,
];

export default async function handler(req, res) {
  const path = req.query.path || '';
  if (!ALLOWED.some(re => re.test(path))) {
    return res.status(400).json({ error: 'Unknown or disallowed WMATA path' });
  }
  try {
    const response = await fetch(`https://api.wmata.com/${path}`, {
      headers: { api_key: process.env.WMATA_KEY },
    });
    if (!response.ok) throw new Error(`WMATA request failed: HTTP ${response.status}`);

    if (path.endsWith('.zip')) {
      // Temporary — binary passthrough for the GTFS static feed.
      const buf = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', 'application/zip');
      res.status(200).send(buf);
      return;
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
