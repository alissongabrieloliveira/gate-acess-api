const db = require('../../config/db');

function countBlocked(table, companyId) {
  return db(table)
    .where({ company_id: companyId, is_blocked: true })
    .whereNull('deleted_at')
    .count('id as count')
    .first();
}

function countPeopleCreatedSince(companyId, from) {
  return db('people')
    .where({ company_id: companyId })
    .whereNull('deleted_at')
    .andWhere('created_at', '>=', from)
    .count('id as count')
    .first();
}

// Agrupa pelo dia no fuso do operador (não em UTC): um acesso às 22h de
// Brasília é do mesmo dia pra quem olha a tela, mesmo já sendo o dia
// seguinte em UTC.
function countAccessesByDayAndGate(companyId, from, timeZone) {
  return db('access_logs')
    .select(db.raw(`to_char(entry_time AT TIME ZONE ?, 'YYYY-MM-DD') AS day`, [timeZone]), 'entry_gate_id')
    .count('id as count')
    .where({ company_id: companyId })
    .whereNull('deleted_at')
    .andWhere('entry_time', '>=', from)
    .groupBy('day', 'entry_gate_id')
    .orderBy('day');
}

module.exports = { countBlocked, countPeopleCreatedSince, countAccessesByDayAndGate };
