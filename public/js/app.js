const CATEGORIES = ['Fruits','Légumes','Viandes & Poissons','Produits Laitiers','Boulangerie & Pâtisserie','Boissons','Épicerie Sèche','Surgelés','Hygiène & Beauté','Entretien Maison','Santé','Snacks & Confiseries','Autres'];
const CAT_ICONS = {'Fruits':'🍎','Légumes':'🥦','Viandes & Poissons':'🥩','Produits Laitiers':'🧀','Boulangerie & Pâtisserie':'🥖','Boissons':'🥤','Épicerie Sèche':'🥫','Surgelés':'🧊','Hygiène & Beauté':'🧴','Entretien Maison':'🧹','Santé':'💊','Snacks & Confiseries':'🍫','Autres':'🛍️'};

/* ══ AUTH ══ */
const Auth = {
  token: localStorage.getItem('riq_token'),
  user:  JSON.parse(localStorage.getItem('riq_user') || 'null'),
  isLoggedIn() { return !!this.token; },
  set(token, user) {
    this.token = token; this.user = user;
    localStorage.setItem('riq_token', token);
    localStorage.setItem('riq_user', JSON.stringify(user));
  },
  clear() {
    this.token = null; this.user = null;
    localStorage.removeItem('riq_token'); localStorage.removeItem('riq_user');
  }
};

/* ══ APP ══ */
const App = {
  receipts: [], period: 'month', _imgBase64: null, _editData: null,

  async init() {
    this._bindAuthUI();
    if (Auth.isLoggedIn()) {
      try { await API.me(); this._showApp(); }
      catch { Auth.clear(); this._showAuth(); }
    } else {
      this._showAuth();
    }
  },

  /* ── AUTH UI ── */
  _bindAuthUI() {
    // Tab switching
    document.querySelectorAll('.auth-tab').forEach(btn =>
      btn.addEventListener('click', () => this._switchAuthForm(btn.dataset.form))
    );
    // Login submit
    document.getElementById('loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const pass  = document.getElementById('loginPassword').value;
      const errEl = document.getElementById('loginError');
      errEl.textContent = '';
      try {
        const r = await API.login(email, pass);
        Auth.set(r.token, r.user);
        this._showApp();
      } catch (err) { errEl.textContent = err.message; }
    });
    // Register submit
    document.getElementById('registerForm').addEventListener('submit', async e => {
      e.preventDefault();
      const name  = document.getElementById('regName').value;
      const email = document.getElementById('regEmail').value;
      const pass  = document.getElementById('regPassword').value;
      const errEl = document.getElementById('registerError');
      errEl.textContent = '';
      try {
        const r = await API.register(name, email, pass);
        Auth.set(r.token, r.user);
        this._showApp();
      } catch (err) { errEl.textContent = err.message; }
    });
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
      Auth.clear(); location.reload();
    });
  },

  _switchAuthForm(form) {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.form === form));
    document.getElementById('loginForm').hidden    = form !== 'login';
    document.getElementById('registerForm').hidden = form !== 'register';
  },

  _showAuth() {
    document.getElementById('authOverlay').hidden = false;
    document.getElementById('mainApp').hidden = true;
  },

  async _showApp() {
    document.getElementById('authOverlay').hidden = true;
    document.getElementById('mainApp').hidden = false;
    // Update navbar
    const u = Auth.user;
    if (u) {
      document.getElementById('userInitial').textContent = u.name.charAt(0).toUpperCase();
      document.getElementById('userNameNav').textContent = u.name;
    }
    this._bindNav();
    this._bindScan();
    this._bindPeriod();
    this._bindFilters();
    await this._load();
    this._renderDashboard();
  },

  async _load() {
    try { this.receipts = await API.list(); } catch { this.receipts = []; }
  },

  /* ── NAV ── */
  _bindNav() {
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.addEventListener('click', () => this.switchTab(b.dataset.tab))
    );
  },
  switchTab(tab) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    if (tab === 'dashboard') this._renderDashboard();
    if (tab === 'history')   this._renderHistory();
  },

  /* ── SCAN ── */
  _bindScan() {
    const area = document.getElementById('uploadArea');
    const fi = document.getElementById('fileInput');
    const ci = document.getElementById('cameraInput');
    document.getElementById('uploadBtn').addEventListener('click', e => { e.stopPropagation(); fi.click(); });
    document.getElementById('cameraBtn').addEventListener('click', e => { e.stopPropagation(); ci.click(); });
    fi.addEventListener('change', e => this._onFile(e.target.files[0]));
    ci.addEventListener('change', e => this._onFile(e.target.files[0]));
    area.addEventListener('click', () => fi.click());
    area.addEventListener('dragover',  e => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
    area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) this._onFile(f); });
    document.getElementById('changeBtn').addEventListener('click',  () => this._resetScan());
    document.getElementById('analyzeBtn').addEventListener('click', () => this._analyze());
    document.getElementById('saveBtn').addEventListener('click',    () => this._save());
    document.getElementById('discardBtn').addEventListener('click', () => this._resetScan());
  },

  _onFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { this._imgBase64 = e.target.result; document.getElementById('previewImg').src = e.target.result; this._show('previewBox'); };
    reader.readAsDataURL(file);
  },

  _resetScan() {
    this._imgBase64 = null; this._editData = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('cameraInput').value = '';
    this._show('uploadBox');
  },

  async _analyze() {
    if (!this._imgBase64) return;
    this._show('loadingBox');
    try {
      const data = await API.analyze(this._imgBase64);
      this._editData = JSON.parse(JSON.stringify(data));
      this._renderResults();
      this._show('resultsBox');
    } catch (err) {
      this._toast('Erreur : ' + err.message, 'err');
      this._show('previewBox');
    }
  },

  _renderResults() {
    const d = this._editData;
    document.getElementById('rStore').value = d.store || '';
    document.getElementById('rDate').value  = d.date  || '';
    this._refreshTotal();
    this._renderEditRows();
  },

  _refreshTotal() {
    const total = (this._editData.items || []).reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
    this._editData.total = Math.round(total * 100) / 100;
    document.getElementById('rTotal').textContent = this._editData.total.toFixed(2) + ' €';
  },

  _renderEditRows() {
    const container = document.getElementById('rCategories');
    container.innerHTML = '';

    (this._editData.items || []).forEach((item, idx) => {
      const catOpts = CATEGORIES.map(c => `<option value="${c}" ${c === item.category ? 'selected' : ''}>${CAT_ICONS[c]} ${c}</option>`).join('');
      const row = document.createElement('div');
      row.className = 'edit-row';
      row.innerHTML = `
        <input class="edit-name"  data-idx="${idx}" value="${this._esc(item.name || '')}" placeholder="Nom du produit">
        <select class="edit-cat" data-idx="${idx}">${catOpts}</select>
        <div class="edit-price-wrap">
          <input class="edit-price" data-idx="${idx}" type="number" min="0" step="0.01" value="${(parseFloat(item.price)||0).toFixed(2)}">
          <span class="edit-eur">€</span>
        </div>
        <button class="edit-del" data-idx="${idx}" title="Supprimer">✕</button>`;
      container.appendChild(row);
    });

    const addRow = document.createElement('div');
    addRow.className = 'edit-add-row';
    addRow.innerHTML = `<button class="btn btn-outline btn-sm" id="addItemBtn">＋ Ajouter un article</button>`;
    container.appendChild(addRow);

    container.querySelectorAll('.edit-name').forEach(el =>
      el.addEventListener('input', e => { this._editData.items[+e.target.dataset.idx].name = e.target.value; })
    );
    container.querySelectorAll('.edit-cat').forEach(el =>
      el.addEventListener('change', e => { this._editData.items[+e.target.dataset.idx].category = e.target.value; })
    );
    container.querySelectorAll('.edit-price').forEach(el =>
      el.addEventListener('input', e => { this._editData.items[+e.target.dataset.idx].price = parseFloat(e.target.value)||0; this._refreshTotal(); })
    );
    container.querySelectorAll('.edit-del').forEach(el =>
      el.addEventListener('click', e => { this._editData.items.splice(+e.target.dataset.idx, 1); this._renderEditRows(); this._refreshTotal(); })
    );
    document.getElementById('addItemBtn').addEventListener('click', () => {
      this._editData.items.push({ name:'', price:0, quantity:1, category:'Autres' });
      this._renderEditRows(); this._refreshTotal();
    });
  },

  async _save() {
    this._editData.store = document.getElementById('rStore').value.trim() || 'Magasin inconnu';
    this._editData.date  = document.getElementById('rDate').value || new Date().toISOString().split('T')[0];
    this._editData.items = (this._editData.items || []).filter(i => i.name.trim() !== '');
    if (!this._editData.items.length) return this._toast('Ajoutez au moins un article', 'err');
    try {
      const saved = await API.save(this._editData);
      this.receipts.push(saved);
      this._toast(`✅ Ticket ${this._editData.store} enregistré !`, 'ok');
      this._resetScan();
      this.switchTab('dashboard');
    } catch (err) { this._toast('Erreur : ' + err.message, 'err'); }
  },

  /* ── DASHBOARD ── */
  _bindPeriod() {
    document.getElementById('periodBar').addEventListener('click', e => {
      const btn = e.target.closest('.period-btn');
      if (!btn) return;
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); this.period = btn.dataset.period; this._renderDashboard();
    });
  },

  _filtered() {
    const now = new Date();
    return this.receipts.filter(r => {
      if (!r.date) return true;
      const d = new Date(r.date + 'T12:00:00');
      switch (this.period) {
        case 'month':   return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
        case '3months': return d >= new Date(now.getFullYear(), now.getMonth()-3, 1);
        case 'year':    return d.getFullYear()===now.getFullYear();
        default:        return true;
      }
    });
  },

  _renderDashboard() {
    const empty = this.receipts.length === 0;
    document.getElementById('dashEmpty').hidden   = !empty;
    document.getElementById('dashContent').hidden =  empty;
    if (empty) return;
    const f = this._filtered();
    const total = f.reduce((s, r) => s+(r.total||0), 0);
    document.getElementById('sTotal').textContent = total.toFixed(2)+' €';
    document.getElementById('sCount').textContent = f.length;
    const sc = {}; f.forEach(r => { if(r.store) sc[r.store]=(sc[r.store]||0)+1; });
    const ts = Object.entries(sc).sort((a,b)=>b[1]-a[1])[0];
    document.getElementById('sStore').textContent = ts ? ts[0] : '–';
    const cs = {}; f.forEach(r => (r.items||[]).forEach(it => { const c=it.category||'Autres'; cs[c]=(cs[c]||0)+(it.price||0); }));
    const tc = Object.entries(cs).sort((a,b)=>b[1]-a[1])[0];
    document.getElementById('sCat').textContent = tc ? `${CAT_ICONS[tc[0]]||''} ${tc[0]}` : '–';
    Charts.updateMonthly(this.receipts);
    Charts.updateCategory(f);
    Charts.updateStore(f);
    this._renderTopItems(f);
  },

  _renderTopItems(receipts) {
    const items = [];
    receipts.forEach(r => (r.items||[]).forEach(it => items.push({ name:it.name, price:it.price||0, category:it.category||'Autres', store:r.store })));
    const top = items.sort((a,b)=>b.price-a.price).slice(0,10);
    const max = top[0]?.price || 1;
    document.getElementById('topItemsWrap').innerHTML = !top.length
      ? '<p style="color:var(--muted);text-align:center;padding:16px">Aucun article</p>'
      : top.map((it,i) => {
          const cls = i===0?'gold':i===1?'silver':i===2?'bronze':'';
          return `<div class="top-item">
            <div class="top-rank ${cls}">${i+1}</div>
            <div class="top-info"><div class="top-name">${this._esc(it.name)}</div><div class="top-meta">${CAT_ICONS[it.category]||'🛍️'} ${it.category}${it.store?' · '+it.store:''}</div></div>
            <div class="top-bar-wrap"><div class="top-bar"><div class="top-bar-fill" style="width:${((it.price/max)*100).toFixed(1)}%"></div></div></div>
            <div class="top-price">${it.price.toFixed(2)} €</div>
          </div>`;
        }).join('');
  },

  /* ── HISTORY ── */
  _bindFilters() {
    document.getElementById('fMonth').addEventListener('change', () => this._renderHistory());
    document.getElementById('fStore').addEventListener('change', () => this._renderHistory());
  },

  _renderHistory() {
    this._updateFilterOptions();
    const mVal = document.getElementById('fMonth').value;
    const sVal = document.getElementById('fStore').value;
    let list = [...this.receipts];
    if (mVal) list = list.filter(r => r.date?.startsWith(mVal));
    if (sVal) list = list.filter(r => r.store === sVal);
    list.sort((a,b) => new Date(b.date)-new Date(a.date));
    document.getElementById('histEmpty').hidden = this.receipts.length > 0;
    const c = document.getElementById('receiptsList');
    c.innerHTML = list.map(r => this._receiptCard(r)).join('');
    c.querySelectorAll('.r-summary').forEach(s => s.addEventListener('click', () => s.closest('.r-card').classList.toggle('open')));
    c.querySelectorAll('.btn-danger[data-id]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); if(confirm('Supprimer ce ticket ?')) this._delete(b.dataset.id); }));
  },

  _receiptCard(r) {
    const date  = r.date ? new Date(r.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) : 'Date inconnue';
    const count = (r.items||[]).length;
    const byCat = {};
    (r.items||[]).forEach(it => { const c=it.category||'Autres'; (byCat[c]=byCat[c]||[]).push(it); });
    const detail = Object.entries(byCat).map(([cat,items]) =>
      `<div class="r-cat-title">${CAT_ICONS[cat]||'🛍️'} ${cat}</div>`+
      items.map(it => `<div class="r-item-line"><span>${this._esc(it.name)}${(it.quantity||1)>1?` ×${it.quantity}`:''}</span><strong>${(it.price||0).toFixed(2)} €</strong></div>`).join('')
    ).join('');
    return `<div class="r-card" data-id="${r.id}">
      <div class="r-summary">
        <div class="r-ico">🧾</div>
        <div class="r-info"><div class="r-store">${this._esc(r.store||'Inconnu')}</div><div class="r-meta"><span>${date}</span><span>${count} article${count>1?'s':''}</span></div></div>
        <div class="r-total">${(r.total||0).toFixed(2)} €</div>
        <div class="r-chevron">▼</div>
      </div>
      <div class="r-detail">${detail}<div class="r-del-row"><button class="btn btn-danger" data-id="${r.id}">🗑️ Supprimer</button></div></div>
    </div>`;
  },

  _updateFilterOptions() {
    const months=new Set(), stores=new Set();
    this.receipts.forEach(r => { if(r.date) months.add(r.date.slice(0,7)); if(r.store) stores.add(r.store); });
    const mSel=document.getElementById('fMonth'); const cur=mSel.value;
    mSel.innerHTML='<option value="">Tous les mois</option>'+[...months].sort().reverse().map(m => { const[y,mo]=m.split('-'); return `<option value="${m}" ${cur===m?'selected':''}>${new Date(+y,+mo-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'})}</option>`; }).join('');
    const sSel=document.getElementById('fStore'); const curS=sSel.value;
    sSel.innerHTML='<option value="">Tous les magasins</option>'+[...stores].sort().map(s=>`<option value="${s}" ${curS===s?'selected':''}>${this._esc(s)}</option>`).join('');
  },

  async _delete(id) {
    try { await API.remove(id); this.receipts=this.receipts.filter(r=>r.id!==id); this._renderHistory(); this._toast('Ticket supprimé','ok'); }
    catch { this._toast('Erreur de suppression','err'); }
  },

  /* ── HELPERS ── */
  _show(id) { ['uploadBox','previewBox','loadingBox','resultsBox'].forEach(bid => { const el=document.getElementById(bid); if(el) el.hidden=bid!==id; }); },
  _toast(msg, type='') { const t=document.getElementById('toast'); t.textContent=msg; t.className='toast '+type; t.hidden=false; clearTimeout(this._tt); this._tt=setTimeout(()=>t.hidden=true,3500); },
  _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
};

document.addEventListener('DOMContentLoaded', () => App.init());
