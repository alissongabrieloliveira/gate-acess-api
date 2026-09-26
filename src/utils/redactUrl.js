// LGPD: buscas levam CPF, nome e placa na URL (?search=, ?cpf=, ?plate=...),
// e a URL ia inteira pro log (Railway) e pro Sentry. Só os parâmetros desta
// lista — ids, paginação, datas, filtros fixos — mantêm o valor; qualquer
// outro, inclusive um parâmetro novo no futuro, sai como [redacted].
const SAFE_QUERY_PARAMS = new Set([
  'action',
  'blocked',
  'entryGateId',
  'from',
  'isActive',
  'limit',
  'operationStatus',
  'page',
  'personId',
  'personType',
  'recordId',
  'status',
  'tableName',
  'timeZone',
  'to',
  'userId',
  'vehicleId',
  'vehicleType',
]);

const REDACTED = '[redacted]';

function redactQuery(query) {
  if (!query || typeof query !== 'object') return query;
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, SAFE_QUERY_PARAMS.has(key) ? value : REDACTED])
  );
}

function redactUrl(url) {
  if (typeof url !== 'string') return url;
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  const parts = [];
  for (const [key, value] of params) {
    parts.push(`${encodeURIComponent(key)}=${SAFE_QUERY_PARAMS.has(key) ? encodeURIComponent(value) : REDACTED}`);
  }
  return `${url.slice(0, queryStart)}?${parts.join('&')}`;
}

module.exports = { redactUrl, redactQuery, REDACTED };
