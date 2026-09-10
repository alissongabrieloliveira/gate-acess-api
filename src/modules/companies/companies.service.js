const AppError = require('../../utils/AppError');
const repository = require('./companies.repository');

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

async function getOwnCompany(companyId) {
  const company = await repository.findById(companyId);
  if (!company) {
    throw new AppError('Empresa não encontrada', 404);
  }
  return company;
}

// Campos editáveis pelo admin da própria empresa (inclui cnpj e state, apesar
// de ambos terem sincronização/validação automática no Postgres — ver
// comentários abaixo). Fora da lista de propósito: `is_active` (flag de ciclo
// de vida do tenant, não é "dado de cadastro" — sem nenhuma tela hoje que
// reative uma empresa desativada, então deixar o admin desativar a própria
// empresa por aqui seria um jeito fácil de se autobloquear sem saída) e
// campos gerenciados só pelo sistema (id, created_at, updated_at, deleted_at).
async function updateOwnCompany(companyId, payload) {
  const changes = {};

  if (payload.corporateName !== undefined) {
    if (!payload.corporateName?.trim()) {
      throw new AppError('Razão social é obrigatória', 400);
    }
    changes.corporate_name = payload.corporateName.trim();
  }
  if (payload.tradeName !== undefined) changes.trade_name = payload.tradeName?.trim() || null;
  if (payload.cnpj !== undefined) changes.cnpj = payload.cnpj;
  if (payload.zipCode !== undefined) changes.zip_code = payload.zipCode || null;
  if (payload.street !== undefined) changes.street = payload.street || null;
  if (payload.addressNumber !== undefined) changes.address_number = payload.addressNumber || null;
  if (payload.complement !== undefined) changes.complement = payload.complement || null;
  if (payload.neighborhood !== undefined) changes.neighborhood = payload.neighborhood || null;
  if (payload.cityId !== undefined) changes.city_id = payload.cityId || null;
  // Só usado de fato quando cityId é null — se cityId vier preenchido, o
  // trigger trg_companies_sync_state (create_companies) sobrescreve este
  // valor com o UF real da cidade escolhida.
  if (payload.state !== undefined) changes.state = payload.state?.trim().toUpperCase() || null;
  if (payload.contactEmail !== undefined) changes.contact_email = payload.contactEmail || null;
  if (payload.contactPhone !== undefined) changes.contact_phone = payload.contactPhone || null;

  if (Object.keys(changes).length === 0) {
    throw new AppError('Nenhum campo para atualizar foi enviado', 400);
  }

  try {
    const company = await repository.update(companyId, changes);
    if (!company) {
      throw new AppError('Empresa não encontrada', 404);
    }
    return company;
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError('CNPJ já cadastrado para outra empresa', 409);
    }
    // chk_valid_cnpj (create_companies) — validação de CNPJ vive só no
    // Postgres (is_valid_cnpj), igual ao resto do cadastro de companies:
    // diferente de people.cpf, o CNPJ não é criptografado, então o CHECK
    // constraint do banco já cobre isso sem precisar duplicar em JS.
    if (err.code === CHECK_VIOLATION) {
      throw new AppError('CNPJ inválido', 400);
    }
    throw err;
  }
}

module.exports = { getOwnCompany, updateOwnCompany };
