const API = {
  _token() { return localStorage.getItem('riq_token') || ''; },
  _h()     { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._token()}` }; },

  async _req(url, opts = {}) {
    const r = await fetch(url, { headers: this._h(), ...opts });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    return j;
  },

  /* AUTH */
  register: (name, email, password) =>
    API._req('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  login: (email, password) =>
    API._req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => API._req('/api/auth/me'),

  /* RECEIPTS */
  analyze: async imageBase64 => {
    const r = await API._req('/api/analyze', { method: 'POST', body: JSON.stringify({ imageBase64 }) });
    return r.data; // unwrap nested { success, data: {...} }
  },
  save: async data => {
    const r = await API._req('/api/receipts', { method: 'POST', body: JSON.stringify(data) });
    return r.data; // unwrap nested { success, data: {...} }
  },
  list:   () => API._req('/api/receipts'),
  remove: id => API._req(`/api/receipts/${id}`, { method: 'DELETE' }),
};
