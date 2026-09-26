const { encryptField, decryptField } = require('../../utils/crypto');

/**
 * LGPD: campos de texto livre podem receber qualquer coisa do operador
 * (motivo de bloqueio, observações), inclusive dado pessoal ou sensível — e
 * ficavam em claro no banco e na trilha de auditoria. Passam a seguir o
 * mesmo padrão de nome/CPF: coluna `*_encrypted` (AES-256-GCM, chave na
 * aplicação). Nenhum deles é usado em busca, então não precisa de bindex.
 *
 * Os dados existentes são criptografados aqui (por isso a migration usa a
 * FIELD_ENCRYPTION_KEY do ambiente em que roda). Durante o preenchimento os
 * triggers da tabela ficam desligados: sem isso, cada UPDATE geraria uma
 * linha de auditoria com o texto em claro em old_data e mexeria em
 * updated_at. A trilha antiga (audit_logs) também é reescrita: a chave em
 * claro vira a chave `*_encrypted` com o mesmo conteúdo, cifrado.
 */
const FIELDS = {
  people: [{ from: 'block_reason', to: 'block_reason_encrypted', type: 'TEXT' }],
  vehicles: [{ from: 'block_reason', to: 'block_reason_encrypted', type: 'TEXT' }],
  access_logs: [
    { from: 'visit_reason', to: 'visit_reason_encrypted', type: 'VARCHAR(255)' },
    { from: 'observation', to: 'observation_encrypted', type: 'TEXT' },
  ],
  fleet_logs: [
    { from: 'purpose', to: 'purpose_encrypted', type: 'VARCHAR(255)' },
    { from: 'observation', to: 'observation_encrypted', type: 'TEXT' },
  ],
};

// `transform(value)` recebe o valor da coluna de origem e devolve o da de
// destino (encryptField na ida, decryptField na volta; ambos preservam null).
async function moveColumns(knex, table, fields, transform) {
  await knex.raw(`ALTER TABLE ?? DISABLE TRIGGER USER`, [table]);

  for (const { to, targetType } of fields) {
    await knex.raw(`ALTER TABLE ?? ADD COLUMN ?? ${targetType}`, [table, to]);
  }

  const sources = fields.map((f) => f.from);
  const rows = await knex(table)
    .select('id', ...sources)
    .where((qb) => sources.forEach((col) => qb.orWhereNotNull(col)));
  for (const row of rows) {
    const changes = Object.fromEntries(fields.map((f) => [f.to, transform(row[f.from])]));
    await knex(table).where({ id: row.id }).update(changes);
  }

  for (const { from } of fields) {
    await knex.raw(`ALTER TABLE ?? DROP COLUMN ??`, [table, from]);
  }

  await knex.raw(`ALTER TABLE ?? ENABLE TRIGGER USER`, [table]);
}

function rewriteSnapshot(data, fields, transform) {
  if (!data) return { data, changed: false };
  let changed = false;
  const result = { ...data };
  for (const { from, to } of fields) {
    if (from in result) {
      result[to] = transform(result[from]);
      delete result[from];
      changed = true;
    }
  }
  return { data: result, changed };
}

async function rewriteAuditTrail(knex, table, fields, transform) {
  const logs = await knex('audit_logs').select('id', 'old_data', 'new_data').where({ table_name: table });
  for (const log of logs) {
    const oldData = rewriteSnapshot(log.old_data, fields, transform);
    const newData = rewriteSnapshot(log.new_data, fields, transform);
    if (oldData.changed || newData.changed) {
      await knex('audit_logs').where({ id: log.id }).update({ old_data: oldData.data, new_data: newData.data });
    }
  }
}

// Coluna cifrada precisa de TEXT: o base64 (IV + tag + texto) passa de 255
// caracteres bem antes do texto original — o limite de 255 continua sendo
// validado no service, sobre o texto em claro.
function forward(fields) {
  return fields.map((f) => ({ from: f.from, to: f.to, targetType: 'TEXT' }));
}

function backward(fields) {
  return fields.map((f) => ({ from: f.to, to: f.from, targetType: f.type }));
}

exports.up = async function up(knex) {
  for (const [table, fields] of Object.entries(FIELDS)) {
    await moveColumns(knex, table, forward(fields), encryptField);
    await rewriteAuditTrail(knex, table, forward(fields), encryptField);
  }
};

exports.down = async function down(knex) {
  for (const [table, fields] of Object.entries(FIELDS)) {
    await moveColumns(knex, table, backward(fields), decryptField);
    await rewriteAuditTrail(knex, table, backward(fields), decryptField);
  }
};
