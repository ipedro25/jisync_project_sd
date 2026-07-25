const pool = require("../config/db");

async function findById(id) {
  const result = await pool.query("SELECT * FROM documents WHERE id=$1", [id]);
  return result.rows[0] || null;
}

/**
 * Documentos "soltos" (fora de qualquer projecto) — é o que o dashboard
 * principal ("Os meus documentos") mostra. Documentos dentro de um
 * projecto só aparecem na página desse projecto (findByLocation).
 *
 * Mostra: os documentos criados por este utilizador, os que não têm dono
 * definido (created_by NULL,compatibilidade com documentos antigos), e
 * os que foram partilhados com este utilizador (document_collaborators).
 */
async function findAll({ page, limit, userId }) {
  const offset = (page - 1) * limit;
  const result = await pool.query(
    `SELECT DISTINCT d.id, d.name, d.word_html, d.excel_data, d.created_at, d.updated_at,
            d.last_edited_by, d.last_edited_at, d.created_by, dc.role AS my_role
     FROM documents d
     LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = $1
     WHERE d.project_id IS NULL
       AND (d.created_by = $1 OR d.created_by IS NULL OR dc.user_id IS NOT NULL)
     ORDER BY d.updated_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  const count = await pool.query(
    `SELECT COUNT(DISTINCT d.id) FROM documents d
     LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = $1
     WHERE d.project_id IS NULL
       AND (d.created_by = $1 OR d.created_by IS NULL OR dc.user_id IS NOT NULL)`,
    [userId]
  );
  return {
    data:  result.rows,
    total: parseInt(count.rows[0].count),
    page,
    limit,
  };
}

/** Documentos dentro de um projecto — na raiz (folderId nulo) ou dentro de uma pasta específica. */
async function findByLocation({ projectId, folderId = null }) {
  const result = await pool.query(
    `SELECT id, name, word_html, excel_data, created_at, updated_at,
            last_edited_by, last_edited_at, folder_id
     FROM documents
     WHERE project_id = $1 AND folder_id IS NOT DISTINCT FROM $2
     ORDER BY updated_at DESC`,
    [projectId, folderId]
  );
  return result.rows;
}

async function create(fields) {
  // Aceita qualquer combinação de: name, word_html, excel_data, project_id, folder_id
  const keys = Object.keys(fields).filter(k => fields[k] !== undefined && fields[k] !== null);
  const values = keys.map(k => fields[k]);

  const cols = keys.join(', ');
  const params = keys.map((_, i) => `$${i + 1}`).join(', ');

  const sql = `INSERT INTO documents (${cols}) VALUES (${params}) RETURNING *`;
  const result = await pool.query(sql, values);
  return result.rows[0];
}

async function update(id, fields) {
  const keys   = Object.keys(fields);
  const values = Object.values(fields);
  const set    = keys.map((k, i) => `${k}=$${i + 1}`).join(", ");
  const result = await pool.query(
    `UPDATE documents SET ${set}, updated_at=NOW()
     WHERE id=$${keys.length + 1}
     RETURNING *`,
    [...values, id]
  );
  return result.rows[0] || null;
}

async function remove(id) {
  const result = await pool.query(
    "DELETE FROM documents WHERE id=$1 RETURNING id",
    [id]
  );
  return result.rows[0] || null;
}

module.exports = { findById, findAll, findByLocation, create, update, remove };