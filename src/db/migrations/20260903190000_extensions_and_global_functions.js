/**
 * Extensões e funções globais usadas pelas demais migrations
 * (triggers de updated_at, validação de CNPJ, blind index HMAC e leitura de claims JWT).
 */
exports.up = async function up(knex) {
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION handle_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION is_valid_cnpj(cnpj text)
    RETURNS boolean AS $$
    DECLARE
        v_soma integer; v_resto integer; v_dv1 integer; v_dv2 integer;
        i integer; v_peso integer[];
    BEGIN
        cnpj := regexp_replace(cnpj, '[^0-9]', '', 'g');
        IF length(cnpj) != 14 THEN RETURN false; END IF;
        IF cnpj ~ '^([0-9])\\1*$' THEN RETURN false; END IF;

        v_peso := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
        v_soma := 0;
        FOR i IN 1..12 LOOP v_soma := v_soma + (cast(substring(cnpj from i for 1) as integer) * v_peso[i]); END LOOP;
        v_resto := v_soma % 11;
        IF v_resto < 2 THEN v_dv1 := 0; ELSE v_dv1 := 11 - v_resto; END IF;
        IF v_dv1 != cast(substring(cnpj from 13 for 1) as integer) THEN RETURN false; END IF;

        v_peso := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
        v_soma := 0;
        FOR i IN 1..13 LOOP v_soma := v_soma + (cast(substring(cnpj from i for 1) as integer) * v_peso[i]); END LOOP;
        v_resto := v_soma % 11;
        IF v_resto < 2 THEN v_dv2 := 0; ELSE v_dv2 := 11 - v_resto; END IF;
        IF v_dv2 != cast(substring(cnpj from 14 for 1) as integer) THEN RETURN false; END IF;

        RETURN true;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);

  // Blind index com HMAC + pepper (app.bindex_pepper deve ser configurado fora do
  // versionamento de código, ex.: ALTER DATABASE seu_banco SET app.bindex_pepper = '...').
  await knex.raw(`
    CREATE OR REPLACE FUNCTION generate_bindex(input_value text)
    RETURNS varchar(64) AS $$
    DECLARE
        v_pepper text;
        v_clean text;
    BEGIN
        v_pepper := current_setting('app.bindex_pepper', true);
        IF v_pepper IS NULL OR v_pepper = '' THEN
            RAISE EXCEPTION 'app.bindex_pepper não configurado — operação bloqueada por segurança';
        END IF;
        v_clean := regexp_replace(lower(input_value), '[^0-9a-z]', '', 'g');
        RETURN encode(hmac(v_clean, v_pepper, 'sha256'), 'hex');
    END;
    $$ LANGUAGE plpgsql STABLE;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION auth_company_id() RETURNS INT AS $$
        SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'company_id', '')::INT
    $$ LANGUAGE sql STABLE;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION auth_user_id() RETURNS INT AS $$
        SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::INT
    $$ LANGUAGE sql STABLE;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP FUNCTION IF EXISTS auth_user_id();`);
  await knex.raw(`DROP FUNCTION IF EXISTS auth_company_id();`);
  await knex.raw(`DROP FUNCTION IF EXISTS generate_bindex(text);`);
  await knex.raw(`DROP FUNCTION IF EXISTS is_valid_cnpj(text);`);
  await knex.raw(`DROP FUNCTION IF EXISTS handle_updated_at();`);
  await knex.raw(`DROP EXTENSION IF EXISTS pgcrypto;`);
};
