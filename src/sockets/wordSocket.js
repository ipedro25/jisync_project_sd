const pool = require("../config/db");
const { setDocumentState, getDocumentState } = require("../redis/documentCache");
const { markEdited, cleanupRoom } = require("../services/autosaveService");
const presenceService = require("../services/presenceService");
const projectService = require("../services/projectService");
const sharingService = require("../services/documentSharingService");
const { notifyDashboard } = require("./dashboardSocket");

const roomContent = {}; // roomId -> { wordHtml, excelData }  (conteúdo em memória, não pessoas)

const LIMITS = {
  EDIT:     20,  // 0–20  → edição completa
  VIEW:     50,  // 21–50 → só leitura
  BLOCKED:  50,  // 50+   → bloqueado
};

module.exports = function wordSocket(io, socket) {

  socket.on("join-room", async ({ roomId, color }) => {
    // Carrega sempre da BD — fonte de verdade
    let doc = await pool.query("SELECT * FROM documents WHERE id=$1", [roomId]);
    if (doc.rows.length === 0) {
      doc = await pool.query(
        "INSERT INTO documents (name, created_by) VALUES ($1, $2) RETURNING *",
        ["Doc " + roomId, socket.user.id]
      );
    }
    const dbDoc = doc.rows[0];

    // Se o documento pertence a um projecto, só membros desse projecto podem entrar.
    // Se for um documento pessoal com dono definido, só o dono ou um colaborador
    // convidado via partilha (document_collaborators) pode entrar — documentos
    // antigos sem dono continuam acessíveis a todos.
    let sharedRole = null; // papel de colaborador partilhado, reaproveitado abaixo
    if (dbDoc.project_id) {
      const isMember = await projectService.isMember(dbDoc.project_id, socket.user.id);
      if (!isMember) {
        socket.emit("access-denied", { message: "Não tens acesso a este documento." });
        return;
      }
    } else if (dbDoc.created_by && dbDoc.created_by !== socket.user.id) {
      sharedRole = await sharingService.getRole(roomId, socket.user.id);
      if (!sharedRole) {
        socket.emit("access-denied", { message: "Não tens acesso a este documento." });
        return;
      }
    }

    socket.join(roomId);
    socket.roomId = roomId;

    // Inicializa o conteúdo em memória da sala, se não existir
    if (!roomContent[roomId]) {
      roomContent[roomId] = {
        wordHtml:  dbDoc.word_html || "",
        excelData: typeof dbDoc.excel_data === "string"
          ? JSON.parse(dbDoc.excel_data)
          : dbDoc.excel_data || [],
      };
    }

    const before = presenceService.getCounts(roomId);
    const total  = before.editors + before.viewers;

    // ── NÍVEL 1: Sala cheia — bloqueado ──
    if (total >= LIMITS.BLOCKED) {
      socket.emit("room-blocked", {
        message: "Este documento atingiu o limite máximo de 50 utilizadores.",
        editors: before.editors,
        viewers: before.viewers,
      });
      socket.leave(roomId);
      return;
    }

    // ── NÍVEL 2: Modo leitura / NÍVEL 3: Edição completa ──
    // Além do limite de capacidade da sala, um "leitor" convidado via
    // partilha fica sempre em modo leitura. Um "editor" convidado segue
    // as mesmas regras de capacidade que o dono.
    const forcedViewer = sharedRole === "viewer";
    socket.isViewer = forcedViewer || before.editors >= LIMITS.EDIT;
    presenceService.joinRoom(roomId, socket.id, socket.user, color, socket.isViewer);
    const after = presenceService.getCounts(roomId);

    socket.emit("join-mode", {
      mode: socket.isViewer ? "view" : "edit",
      message: forcedViewer
        ? "Tens acesso de leitura a este documento."
        : socket.isViewer
        ? `O limite de ${LIMITS.EDIT} editores foi atingido. Entraste em modo de leitura.`
        : null,
      editors: after.editors,
      viewers: after.viewers,
    });

    // Envia documento e lista de utilizadores
    const room = presenceService.getRoom(roomId);
    socket.emit("init-document", { ...roomContent[roomId], users: room.users, viewers: room.viewers });
    io.to(roomId).emit("users-update", { users: room.users, viewers: room.viewers });
  });

  socket.on("word-change", async (html) => {
    const roomId = socket.roomId;
    if (!roomContent[roomId]) return;

    // Leitores não podem editar
    if (socket.isViewer) {
      socket.emit("edit-denied", { message: "Estás em modo de leitura. Não podes editar este documento." });
      return;
    }

    roomContent[roomId].wordHtml = html;

    // Redis absorve a escrita em tempo real. O Postgres só é actualizado
    // pelo ciclo de autosave (a cada 10s) — ver services/autosaveService.js.
    const state = await getDocumentState(roomId).catch(() => ({})) || {};
    await setDocumentState(roomId, { ...state, wordHtml: html }).catch(() => null);
    markEdited(roomId, socket.user.name);
    notifyDashboard(io, roomId, socket.user.name, "word");

    socket.to(roomId).emit("word-update", html);
  });

  // Nota: o evento "cursor-move" passou a ser tratado apenas em cursorSocket.js,
  // para evitar dois handlers a emitir "cursor-update" para o mesmo evento.

  socket.on("disconnect", async () => {
    const roomId = socket.roomId;
    if (!roomId) return;

    presenceService.leaveRoom(roomId, socket.id);
    const room = presenceService.getRoom(roomId);

    io.to(roomId).emit("users-update", { users: room.users, viewers: room.viewers });

    const total = Object.keys(room.users).length + Object.keys(room.viewers).length;
    if (total === 0) {
      delete roomContent[roomId];
      presenceService.cleanupIfEmpty(roomId);
      await cleanupRoom(roomId);
    }
  });
};