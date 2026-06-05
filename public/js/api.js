const API = {
  async analyze(imageBase64) {
    const r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 })
    });
    const json = await r.json();
    if (!r.ok || !json.success) throw new Error(json.error || 'Erreur analyse');
    return json.data;
  },

  async save(receiptData) {
    const r = await fetch('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receiptData)
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Erreur sauvegarde');
    return json.data;
  },

  async list() {
    const r = await fetch('/api/receipts');
    if (!r.ok) throw new Error('Erreur chargement');
    return r.json();
  },

  async remove(id) {
    const r = await fetch(`/api/receipts/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Erreur suppression');
    return r.json();
  }
};
