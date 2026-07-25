const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { secret, expiresIn } = require("../config/jwt");
const userModel = require("../models/userModel");

const SALT_ROUNDS = 12;
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutos
const loginAttempts = new Map(); // name -> { count, lockedUntil }

//Função para verificar se o utilizador está bloqueado devido a tentativas falhadas 
function checkLockout(name) {
  const entry = loginAttempts.get(name);
  if (!entry) return;
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    throw Object.assign(
      new Error(`Demasiadas tentativas falhadas. Tenta novamente daqui a ${minutesLeft} min.`),
      { name: "TooManyRequestsError" }
    );
  }
}

function registerFailedAttempt(name) {
  const entry = loginAttempts.get(name) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(name, entry);
}

function clearAttempts(name) {
  loginAttempts.delete(name);
}

async function login(name, password) {
  checkLockout(name);

  const user = await userModel.findByName(name);
  if (!user) {
    registerFailedAttempt(name);
    throw Object.assign(new Error("User not found"), { name: "UnauthorizedError" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    registerFailedAttempt(name);
    throw Object.assign(new Error("Wrong password"), { name: "UnauthorizedError" });
  }

  clearAttempts(name);
  return jwt.sign({ id: user.id, name: user.name }, secret, { expiresIn });
}

async function register({ name, email, password, organization = null, role = null }) {
  const existing = await userModel.findByEmail(email);
  if (existing) throw Object.assign(new Error("Email already in use"), { name: "ConflictError" });

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await userModel.create({ name, email, password: hashed, organization, role });
  return { id: user.id, name: user.name, email: user.email, organization: user.organization, role: user.role };
}

async function refreshToken(token) {
  try {
    const decoded = jwt.verify(token, secret);
    return jwt.sign({ id: decoded.id, name: decoded.name }, secret, { expiresIn });
  } catch {
    throw Object.assign(new Error("Invalid or expired token"), { name: "UnauthorizedError" });
  }
}

async function logout(token) {
  // Se usares Redis podes adicionar o token a uma blacklist aqui:
  // await redis.set(`blacklist:${token}`, 1, "EX", <tempo_expiracao>);
  return true;
}

async function sendPasswordReset(email) {
  const user = await userModel.findByEmail(email);
  // Não revelas se o email existe ou não — segurança contra enumeração
  if (!user) return;

  const resetToken = jwt.sign({ id: user.id }, secret, { expiresIn: "15m" });
  await userModel.saveResetToken(user.id, resetToken);

  // TODO: integrar serviço de email (ex: nodemailer, SendGrid)
  console.log(`[AuthService] Reset token para ${email}: ${resetToken}`);
}

async function resetPassword(token, newPassword) {
  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch {
    throw Object.assign(new Error("Invalid or expired reset token"), { name: "UnauthorizedError" });
  }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await userModel.updatePassword(decoded.id, hashed);
  await userModel.clearResetToken(decoded.id);
}

async function findUsers({ page, limit, search }) {
  return userModel.findAll({ page, limit, search });
}

async function findUserById(id) {
  return userModel.findById(id);
}

async function updateUser(id, updates) {
  return userModel.update(id, updates);
}

async function deleteUser(id) {
  return userModel.remove(id);
}

module.exports = {
  login,
  register,
  refreshToken,
  logout,
  sendPasswordReset,
  resetPassword,
  findUsers,
  findUserById,
  updateUser,
  deleteUser,
};