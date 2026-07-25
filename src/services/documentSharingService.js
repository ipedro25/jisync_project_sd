const collaboratorModel = require("../models/documentCollaboratorModel");
const userModel = require("../models/userModel");

//Função para partilha de documentos entre membros
async function shareDocument(documentId, email, role = "editor") {
  const user = await userModel.findByEmail(email);
  if (!user) throw Object.assign(new Error("Não existe nenhum utilizador com esse email"), { name: "NotFoundError" });
  return collaboratorModel.add(documentId, user.id, role);
}

//Função para remover a partilha de documentos
async function unshareDocument(documentId, userId) {
  return collaboratorModel.remove(documentId, userId);
}

//Função para listar os colaboradores que partilham documentos
async function listCollaborators(documentId) {
  return collaboratorModel.listByDocument(documentId);
}

async function getRole(documentId, userId) {
  return collaboratorModel.getRole(documentId, userId);
}

module.exports = { shareDocument, unshareDocument, listCollaborators, getRole };