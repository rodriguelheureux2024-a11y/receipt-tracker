const Charts = {
  _instances: {},

  CAT_COLORS: {
    'Fruits':                 '#22c55e',
    'Légumes':                '#4ade80',
    'Viandes & Poissons':     '#ef4444',
    'Produits Laitiers':      '#fbbf24',
    'Boulangerie & Pâtisserie': '#f97316',
    'Boissons':               '#3b82f6',
    'Épicerie Sèche':         '#8b5cf6',
    'Surgelés':               '#06b6d4',
    'Hygiène & Beauté':       '#ec4899',
    'Entretien Maison':       '#64748b',
    'Santé':                  '#0ea5e9',
    'Snacks & Confiseries':   '#f59e0b',
    'Autres':                 '#94a3b8',
  },

  color(cat) { return this.CAT_COLORS[cat] || '#94a3b8'; },

  _destroy(name) {
    if (this._instances[name]) { this._instances[name].destroy(); delete this._instances[name]; }
  },

  updateMonthly(allReceipts) {
    this._destroy('monthly');
    const ctx = document.getElementById('monthlyChart');
    if (!ctx) return;

    const now = new Date();
    const labels = [], values = [], bgs = [], borders = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const isCurrentMonth = i === 0;
      labels.push(d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }));
      const total = allReceipts
        .filter(r => r.date && r.date.startsWith(key))
        .reduce((s, r) => s + (r.total || 0), 0);
      values.push(+total.toFixed(2));
      bgs.push(isCurrentMonth ? 'rgba(16,185,129,.25)' : 'rgba(16,185,129,.12)');
      borders.push(isCurrentMonth ? '#059669' : '#10b981');
    }

    const yearTotal = allReceipts
      .filter(r => r.date && r.date.startsWith(now.getFullYear().toString()))
      .reduce((s, r) => s + (r.total || 0), 0);
    const sub = document.getElementById('monthlySubtitle');
    if (sub) sub.textContent = `Total ${now.getFullYear()} : ${yearTotal.toFixed(2)} €`;

    this._instances.monthly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Dépenses (€)', data: values,
          backgroundColor: bgs, borderColor: borders,
          borderWidth: 2, borderRadius: 8, borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `  ${c.raw.toFixed(2)} €` } }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: v => v + ' €', font: { size: 12 } },
            grid: { color: '#f1f5f9' }
          },
          x: { grid: { display: false }, ticks: { font: { size: 12 } } }
        }
      }
    });
  },

  updateCategory(receipts) {
    this._destroy('category');
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;

    const totals = {};
    receipts.forEach(r => (r.items || []).forEach(item => {
      const c = item.category || 'Autres';
      totals[c] = (totals[c] || 0) + (item.price || 0);
    }));

    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return;

    this._instances.category = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: sorted.map(([k]) => k),
        datasets: [{
          data: sorted.map(([, v]) => +v.toFixed(2)),
          backgroundColor: sorted.map(([k]) => this.color(k)),
          borderWidth: 2, borderColor: '#fff',
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 12 } } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw.toFixed(2)} €` } }
        }
      }
    });
  },

  updateStore(receipts) {
    this._destroy('store');
    const ctx = document.getElementById('storeChart');
    if (!ctx) return;

    const totals = {};
    receipts.forEach(r => {
      const s = r.store || 'Inconnu';
      totals[s] = (totals[s] || 0) + (r.total || 0);
    });

    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!sorted.length) return;

    this._instances.store = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(([k]) => k),
        datasets: [{
          label: 'Total (€)',
          data: sorted.map(([, v]) => +v.toFixed(2)),
          backgroundColor: '#818cf8',
          borderRadius: 6, borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `  ${c.raw.toFixed(2)} €` } }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { callback: v => v + ' €', font: { size: 12 } },
            grid: { color: '#f1f5f9' }
          },
          y: { grid: { display: false }, ticks: { font: { size: 12 } } }
        }
      }
    });
  },

  destroyAll() {
    ['monthly', 'category', 'store'].forEach(n => this._destroy(n));
  }
};
