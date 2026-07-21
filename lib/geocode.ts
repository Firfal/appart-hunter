// Géocodage via la Base Adresse Nationale (gratuit, sans clé, CORS ouvert).
export type GeoSuggestion = { label: string; lat: number; lng: number };

export async function geocode(query: string): Promise<GeoSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features ?? []).map((f: {
    properties: { label: string };
    geometry: { coordinates: [number, number] };
  }) => ({
    label: f.properties.label,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}
