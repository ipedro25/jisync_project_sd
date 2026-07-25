// Fonte única de verdade sobre quem está presente em cada sala (documento).
// Antes, o wordSocket.js mantinha a sua própria cópia disto — agora usa
// este serviço, que também permite ao dashboard saber quantas pessoas
// estão a editar cada documento neste momento.

const rooms = {}; // roomId -> { users: {socketId:{name,color}}, viewers: {socketId:{name,color}} }


function joinRoom(roomId, socketId, user, color, isViewer = false) {
  if (!rooms[roomId]) rooms[roomId] = { users: {}, viewers: {} };
  if (isViewer) rooms[roomId].viewers[socketId] = { name: user.name, color };
  else          rooms[roomId].users[socketId]   = { name: user.name, color };
  return rooms[roomId];
}

function leaveRoom(roomId, socketId) {
  if (!rooms[roomId]) return null;
  delete rooms[roomId].users[socketId];
  delete rooms[roomId].viewers[socketId];
  return rooms[roomId];
}

function getRoom(roomId) {
  return rooms[roomId] || { users: {}, viewers: {} };
}

function getCounts(roomId) {
  const r = getRoom(roomId);
  return {
    editors: Object.keys(r.users).length,
    viewers: Object.keys(r.viewers).length,
  };
}

/** Devolve { [roomId]: {editors, viewers} } só para salas com gente lá dentro. */
function getAllActiveCounts() {
  const result = {};
  for (const roomId of Object.keys(rooms)) {
    const c = getCounts(roomId);
    if (c.editors + c.viewers > 0) result[roomId] = c;
  }
  return result;
}

/** Chamar depois de leaveRoom, para não deixar salas vazias em memória. */
function cleanupIfEmpty(roomId) {
  const r = rooms[roomId];
  if (!r) return;
  if (Object.keys(r.users).length + Object.keys(r.viewers).length === 0) {
    delete rooms[roomId];
  }
}

module.exports = { joinRoom, leaveRoom, getRoom, getCounts, getAllActiveCounts, cleanupIfEmpty };