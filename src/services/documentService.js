const fs = require('fs').promises;
const path = require('path');
const documentModel = require("../models/documentModel");
const { getDocumentState, setDocumentState, deleteDocumentState } = require("../redis/documentCache");


//Função para carregar um documento do Redis ou criar um novo se não existir
async function loadOrCreate(id, userId) {
  // 1. Tenta Redis primeiro
  const cached = await getDocumentState(id).catch(() => null);
  if (cached) return cached;

  // 2. Vai ao PostgreSQL
  let doc = await documentModel.findById(id);

  // 3. Cria se não existir
  if (!doc) {
    doc = await documentModel.create({ name: "Documento sem título", created_by: userId || null });
  }

  // 4. Guarda no Redis
  await setDocumentState(id, doc).catch(() => null);
  return doc;
}


//Função para listar todos os documentos, com paginação e filtragem por usuário
async function findAll({ page, limit, userId }) {
  return documentModel.findAll({ page, limit, userId });
}

/** Documentos dentro de um projecto (raiz ou dentro de uma pasta específica). */
async function findByLocation({ projectId, folderId = null }) {
  return documentModel.findByLocation({ projectId, folderId });
}


//Função para criar um novo documento, com base em um template (opcional)
async function create(args) {
  const { name, type, template, projectId, folderId, createdBy } = args;

  const payload = { name };
  if (projectId)  payload.project_id = projectId;
  if (folderId)   payload.folder_id  = folderId;
  if (createdBy)  payload.created_by = createdBy;

  try {
    if (type === 'word') {
      const tpl = template || 'blank';
      const file = path.join(__dirname, '..', 'templates', 'word', `${tpl}.html`);
      const html = await fs.readFile(file, 'utf8').catch(() => null);
      if (html) payload.word_html = html.replace('{{author}}', (args.author || ''));
    } else if (type === 'excel') {
      const tpl = template || 'blank';
      const file = path.join(__dirname, '..', 'templates', 'excel', `${tpl}.json`);
      const data = await fs.readFile(file, 'utf8').catch(() => null);
      if (data) payload.excel_data = data;
    }
  } catch (err) {
    console.warn('[DocumentService] load template failed', err.message);
  }

  return documentModel.create(payload);
}

//Função para atualizar um documento existente, com invalidação de cache Redis
async function update(id, fields) {
  const doc = await documentModel.update(id, fields);
  // Invalida cache Redis para forçar releitura
  await setDocumentState(id, doc).catch(() => null);
  return doc;
}

//Função para renomear um documento existente
async function rename(id, name) {
  return update(id, { name });
}

//Função para remover um documento existente, com invalidação de cache Redis
async function remove(id) {
  await deleteDocumentState(id).catch(() => null);
  return documentModel.remove(id);
}

//Exporta as funções do serviço de documentos
module.exports = { loadOrCreate, findAll, findByLocation, create, update, rename, remove };