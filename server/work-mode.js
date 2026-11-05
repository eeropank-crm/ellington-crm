// Account capability is read from the database; session mode can only narrow it.
function sessionUser(user, session) {
  const mode = user.role === 'admin' && session.workMode === 'admin' ? 'admin' : 'user';
  return { ...user, accountRole: user.role, mode, role: mode === 'admin' ? 'admin' : 'sales' };
}
module.exports = { sessionUser };
