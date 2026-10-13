/**
 * O gateway passa a ser um app que o porteiro abre no início e fecha no fim do
 * expediente (app Electron do repositório gateway). Ao fechar normalmente, o
 * app avisa o backend (mensagem `shutdown` no WebSocket) e a hora fica aqui:
 * o alerta do sininho mostra "encerrado pelo operador" em vez do alarme de
 * gateway offline. Volta a NULL quando o gateway reconecta.
 *
 * No banco (e não só em memória como connectionRegistry) para sobreviver a um
 * deploy/reinício do backend com o gateway fechado. O GRANT do app_runtime é
 * por tabela, então a coluna nova já está coberta.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE gateway_devices ADD COLUMN closed_by_operator_at TIMESTAMPTZ NULL;');
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE gateway_devices DROP COLUMN IF EXISTS closed_by_operator_at;');
};
