// Proxies Maryland CHART's travel-time-routes feed. This endpoint has no CORS headers
// (confirmed by direct check) and has no official ArcGIS Open Data equivalent (confirmed
// by searching Maryland's full CHART-tagged catalog) — it's the undocumented endpoint the
// public chart.maryland.gov site itself calls, proxied server-side purely to work around
// the missing CORS, not to hide a key (there isn't one).
export default async function handler(req, res) {
  try {
    const response = await fetch('https://chartexp1.sha.maryland.gov/CHARTExportClientService/getTravelRouteDataJSON.do');
    if (!response.ok) throw new Error(`CHART travel-times request failed: HTTP ${response.status}`);

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=180');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
