const cities = require('./data/cities_ibge.json');

/**
 * Popula a tabela global `cities` (sem company_id — compartilhada entre
 * todos os tenants, ver claude.md seção 4.1) com os municípios do Brasil.
 * Serão usadas no campo "Destino" do Controle de Frota (registro de saída
 * de veículo), em vez de texto livre.
 *
 * `data/cities_ibge.json` é uma cópia congelada da base oficial do IBGE
 * (https://servicodados.ibge.gov.br/api/v1/localidades/municipios, baixada
 * em 2026-09-06) — o seed não busca da API toda vez que roda, pra não
 * depender de rede/disponibilidade externa num comando local de dev, e pra
 * ser reprodutível (mesmos dados sempre, independente de mudanças futuras
 * na API do IBGE).
 *
 * Idempotente via `ON CONFLICT (ibge_code) DO NOTHING`: rodar `npm run seed`
 * de novo não duplica nem falha se as cidades já existirem. Inserido em
 * lotes (não uma linha de cada vez, nem tudo numa query só) — ~5.570
 * municípios cabem longe do limite de parâmetros do Postgres em lotes de
 * 1000, mas uma única query com todas as linhas seria desnecessariamente
 * grande.
 */
const CHUNK_SIZE = 1000;

exports.seed = async function seed(knex) {
  const rows = cities.map((city) => ({
    name: city.name,
    state_abbr: city.stateAbbr,
    ibge_code: city.ibgeCode,
  }));

  let inserted = 0;
  await knex.transaction(async (trx) => {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const result = await trx('cities').insert(chunk).onConflict('ibge_code').ignore().returning('id');
      inserted += result.length;
    }
  });

  console.log(`[seed] Cidades: ${inserted} nova(s) inserida(s) de ${rows.length} no total (restante já existia).`);
};
