/**
 * Liga uma "direção" lógica (ENTRY/EXIT) a uma ou mais saídas de relé de um
 * `gateway_device`. Desacoplado do catálogo `gates` (Portaria 1/SET
 * LOCAL/Carga, usado só pra registrar "por onde esse visitante/veículo
 * passou") — as cancelas de entrada/saída são compartilhadas entre
 * Controle de Acessos e Controle de Frota, não vinculadas a um portão
 * específico do catálogo.
 *
 * ENTRY pode ter mais de 1 saída (ex.: 2 braços de cancela acionados ao
 * mesmo tempo, no mesmo frame MTCP — ver gateway/src/mtcpProtocol.js). Por
 * isso não há UNIQUE(direction) nem UNIQUE(gate_id) como na versão
 * anterior — só UNIQUE(gateway_device_id, output_number), já que uma
 * saída física de relé só pode representar uma coisa por vez.
 *
 * `host`/`port`/`ns` guardam o endereço de rede real da controladora
 * física (decisão revista em 2026-09-14: inicialmente essa informação só
 * vivia num arquivo local do gateway, mas isso impedia reconfigurar sem
 * acesso físico/remoto à máquina do cliente — agora o gateway recebe isso
 * pelo próprio WebSocket já usado pros comandos, ver
 * backend/src/gatewayWs/gatewayWs.js). Nunca expor essas 3 colunas na API
 * pública (GET /gate-directions) — só o gatewayWs lê direto do banco.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE gate_direction_outputs (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        gateway_device_id INT NOT NULL REFERENCES gateway_devices(id) ON DELETE RESTRICT,
        direction VARCHAR(5) NOT NULL CHECK (direction IN ('ENTRY','EXIT')),
        output_number SMALLINT NOT NULL CHECK (output_number BETWEEN 1 AND 4),
        current_state VARCHAR(3) NOT NULL DEFAULT 'OFF' CHECK (current_state IN ('ON','OFF')),
        host VARCHAR(255) NOT NULL,
        port INT NOT NULL CHECK (port BETWEEN 1 AND 65535),
        ns VARCHAR(5) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (gateway_device_id, output_number)
    );
  `);

  await knex.raw(`CREATE INDEX idx_gate_direction_outputs_company_id ON gate_direction_outputs(company_id);`);
  await knex.raw(`CREATE INDEX idx_gate_direction_outputs_gateway_device_id ON gate_direction_outputs(gateway_device_id);`);
  await knex.raw(`CREATE INDEX idx_gate_direction_outputs_direction ON gate_direction_outputs(company_id, direction);`);

  await knex.raw(`
    CREATE TRIGGER trg_gate_direction_outputs_updated_at BEFORE UPDATE ON gate_direction_outputs
        FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
  `);
  await knex.raw(`
    CREATE TRIGGER trg_audit_gate_direction_outputs AFTER INSERT OR UPDATE OR DELETE ON gate_direction_outputs
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
  `);

  await knex.raw(`ALTER TABLE gate_direction_outputs ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY "Políticas de saídas de cancela (Leitura)" ON gate_direction_outputs
        FOR SELECT USING (company_id = auth_company_id());
  `);
  await knex.raw(`
    CREATE POLICY "Políticas de saídas de cancela (Inserir)" ON gate_direction_outputs
        FOR INSERT WITH CHECK (company_id = auth_company_id());
  `);
  await knex.raw(`
    CREATE POLICY "Políticas de saídas de cancela (Atualizar)" ON gate_direction_outputs
        FOR UPDATE USING (company_id = auth_company_id()) WITH CHECK (company_id = auth_company_id());
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS gate_direction_outputs CASCADE;`);
};
