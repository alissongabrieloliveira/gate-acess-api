/**
 * companies só tinha policy de SELECT (schema original só previa leitura —
 * criação de tenant era só via seed). Agora que a API expõe `PUT /companies/me`
 * (admin edita o cadastro da própria empresa), adiciona a policy de UPDATE que
 * faltava — mesmo padrão de gates/sectors (USING e WITH CHECK idênticos,
 * impede ler ou gravar fora do próprio tenant).
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE POLICY "Permitir atualização da própria empresa" ON companies
        FOR UPDATE USING (id = auth_company_id() AND deleted_at IS NULL) WITH CHECK (id = auth_company_id());
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP POLICY IF EXISTS "Permitir atualização da própria empresa" ON companies;`);
};
