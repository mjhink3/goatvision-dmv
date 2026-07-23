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
  // Real-time bus arrival predictions (Metrobus panel) — confirmed genuinely live via GPS,
  // not schedule data. WMATA's casing is inconsistent between services, hence case-insensitive.
  /^NextBusService\.svc\/json\/jPredictions(\?.*)?$/i,
  // Temporary — sourcing one real StopID per Metrobus route from WMATA's own route/stop
  // data (more reliable than a geo lookup, since it's tied directly to the route). Remove
  // once the 12 StopIDs are captured into the client.
  /^Routes\.svc\/json\/jRouteDetails(\?.*)?$/i,
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

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
