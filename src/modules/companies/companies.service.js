const AppError = require('../../utils/AppError');
const repository = require('./companies.repository');
const withAuthTransaction = require('../../utils/withAuthTransaction');
const { deletePhoto, getSignedUrls } = require('../../utils/supabaseStorage');

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

// logo_url no banco é o CAMINHO no bucket privado; a resposta troca pela URL
// assinada (ou null se a assinatura falhar) — mesmo padrão de photo_url em
// people/vehicles.
async function withSignedLogo(company) {
  if (!company?.logo_url) return company;
  const signed = await getSignedUrls([company.logo_url]);
  return { ...company, logo_url: signed.get(company.logo_url) ?? null };
}

async function getOwnCompany(companyId) {
  const company = await repository.findById(companyId);
  if (!company) {
    throw new AppError('Empresa não encontrada', 404);
  }
  return withSignedLogo(company);
}

async function replaceLogo(auth, logoPath) {
  const existing = await repository.findById(auth.companyId);
  if (!existing) {
    throw new AppError('Empresa não encontrada', 404);
  }
  const company = await withAuthTransaction(auth, (trx) =>
    repository.update(auth.companyId, { logo_url: logoPath }, trx)
  );
  // Só depois de gravar: se a escrita falhar, a logo antiga continua valendo.
  if (existing.logo_url && existing.logo_url !== logoPath) {
    await deletePhoto(existing.logo_url);
  }
  return withSignedLogo(company);
}

function setLogo(auth, logoPath) {
  return replaceLogo(auth, logoPath);
}

function removeLogo(auth) {
  return replaceLogo(auth, null);
}

// Campos editáveis pelo admin da própria empresa (inclui cnpj e state, apesar
// de ambos terem sincronização/validação automática no Postgres — ver
// comentários abaixo). Fora da lista de propósito: `is_active` (flag de ciclo
// de vida do tenant, não é "dado de cadastro" — sem nenhuma tela hoje que
// reative uma empresa desativada, então deixar o admin desativar a própria
// empresa por aqui seria um jeito fácil de se autobloquear sem saída) e
// campos gerenciados só pelo sistema (id, created_at, updated_at, deleted_at).
async function updateOwnCompany(auth, payload) {
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
  if (payload.privacyContact !== undefined) {
    const contact = payload.privacyContact?.trim() || null;
    if (contact && contact.length > 255) {
      throw new AppError('Contato de privacidade pode ter no máximo 255 caracteres', 400);
    }
    changes.privacy_contact = contact;
  }

  if (Object.keys(changes).length === 0) {
    throw new AppError('Nenhum campo para atualizar foi enviado', 400);
  }

  try {
    // withAuthTransaction configura request.jwt.claims na transação —
    // trg_audit_companies (log_audit_event) lê isso pra gravar quem fez a
    // alteração em audit_logs.user_id. Sem isso, toda edição apareceria na
    // Auditoria com usuário em branco.
    const company = await withAuthTransaction(auth, (trx) => repository.update(auth.companyId, changes, trx));
    if (!company) {
      throw new AppError('Empresa não encontrada', 404);
    }
    return withSignedLogo(company);
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

module.exports = { getOwnCompany, updateOwnCompany, setLogo, removeLogo };
