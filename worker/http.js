// Réponse JSON standard du Worker (jamais mise en cache).
export const json = (objet, code = 200) => new Response(JSON.stringify(objet), {
  status: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
