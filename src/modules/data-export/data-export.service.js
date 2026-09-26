const repository = require('./data-export.repository');
const peopleService = require('../people/people.service');
const accessLogsService = require('../access-logs/access-logs.service');
const fleetLogsService = require('../fleet-logs/fleet-logs.service');

// Colunas técnicas (ids, carimbos de data, índice de busca) não são
// "dado da pessoa" — ficam fora do histórico de alterações.
const TECHNICAL_FIELDS = new Set(['id', 'company_id', 'created_at', 'updated_at', 'cpf_bindex']);

function fieldName(column) {
  return column.replace(/_encrypted$/, '');
}

// Só os NOMES dos campos alterados: os valores antigos ficam cifrados na
// trilha e o estado atual já vai no cadastro exportado.
function changedFields(oldData, newData) {
  const keys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);
  return [...keys]
    .filter((key) => !TECHNICAL_FIELDS.has(key))
    .filter((key) => {
      const before = oldData ? oldData[key] : null;
      const after = newData ? newData[key] : null;
      // Na criação, "false" (ex.: não bloqueado) é só o valor padrão, não
      // um dado informado — fica fora pra não poluir a lista.
      if (!oldData && after === false) return false;
      return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
    })
    .map(fieldName)
    .sort();
}

// Registro de acesso/frota no formato da exportação: sem ids de operador
// (quem registrou é dado de outra pessoa) e sem caminho interno de arquivo no
// Storage — só se existe foto/recibo assinado.
function exportAccessLog({ entryOperatorId, exitOperatorId, photoUrl, signedReceiptUrl, ...log }) {
  return { ...log, hasVehiclePhoto: Boolean(photoUrl), hasSignedReceipt: Boolean(signedReceiptUrl) };
}

function exportFleetLog({ departureOperatorId, returnOperatorId, ...log }) {
  return log;
}

/**
 * LGPD art. 18/19 (confirmação e acesso): tudo o que o sistema guarda sobre
 * uma pessoa, num só lugar — cadastro, acessos como visitante e como
 * anfitriã, saídas de frota como motorista e o histórico de alterações do
 * cadastro (sem nome de quem alterou: é dado de outra pessoa).
 */
async function exportPersonData(auth, personId) {
  const { companyId, userId } = auth;
  const person = await peopleService.getById(companyId, personId);

  const [company, accessLogs, fleetLogsAsDriver, trail] = await Promise.all([
    repository.findCompanyName(companyId),
    accessLogsService.listAllForPerson(companyId, personId),
    fleetLogsService.listAllForDriver(companyId, personId),
    repository.findPersonAuditTrail(companyId, personId),
  ]);

  await repository.insertExportRecord({ companyId, userId, personId });

  return {
    generatedAt: new Date().toISOString(),
    company: {
      name: company.trade_name || company.corporate_name,
      corporateName: company.corporate_name,
      cnpj: company.cnpj,
    },
    person,
    accessLogsAsVisitor: accessLogs.asVisitor.map(exportAccessLog),
    accessLogsAsHost: accessLogs.asHost.map(exportAccessLog),
    fleetLogsAsDriver: fleetLogsAsDriver.map(exportFleetLog),
    changeHistory: trail.map((entry) => ({
      action: entry.action,
      changedAt: entry.changed_at,
      fields: entry.action === 'EXPORT' ? [] : changedFields(entry.old_data, entry.new_data),
    })),
  };
}

module.exports = { exportPersonData };
