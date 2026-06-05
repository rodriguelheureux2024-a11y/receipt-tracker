const express  = require('express');
const multer   = require('multer');
const { Mistral } = require('@mistralai/mistralai');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

const app     = express();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const JWT_SECRET   = process.env.JWT_SECRET || 'receiptiq-dev-secret-change-in-prod';
const DATA_DIR     = path.join(__dirname, 'data');
const USERS_FILE   = path.join(DATA_DIR, 'users.json');
const REC_DIR      = path.join(DATA_DIR, 'receipts');

[DATA_DIR, REC_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');


app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ── DATA HELPERS ── */
const loadUsers = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } };
const saveUsers = u  => fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
const loadRec   = id => { try { return JSON.parse(fs.readFileSync(path.join(REC_DIR, `${id}.json`), 'utf8')); } catch { return []; } };
const saveRec   = (id, data) => fs.writeFileSync(path.join(REC_DIR, `${id}.json`), JSON.stringify(data, null, 2));

/* ── AUTH MIDDLEWARE ── */
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non authentifié' });
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expirée — reconnectez-vous' }); }
}

/* ── AUTH ROUTES ── */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Tous les champs sont requis' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });
    const users = loadUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'Email déjà utilisé' });
    const user = { id: crypto.randomUUID(), name: name.trim(), email: email.toLowerCase().trim(), password: await bcrypt.hash(password, 10), createdAt: new Date().toISOString() };
    users.push(user);
    saveUsers(users);
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email?.toLowerCase().trim());
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, (req, res) => res.json({ id: req.user.id, name: req.user.name, email: req.user.email }));

/* ── RECEIPT PROMPT ── */
const PROMPT = `You are a receipt data extraction expert. Read this receipt image very carefully.

Return ONLY a valid JSON object — nothing else, no explanation.

{"store":"STORE NAME","date":"YYYY-MM-DD","total":38.74,"items":[{"name":"Full Product Name","price":5.79,"quantity":1,"category":"Category"}]}

HOW TO READ THIS RECEIPT:
Each purchased item appears as ONE LINE containing: [barcode number] [PRODUCT NAME] [tax code] [PRICE]
- The price at the END of that same line = the price you paid for that item
- "Regular Price $X.XX" = the old/original price — DO NOT use this, DO NOT include it as an item
- "Save $X" / "6for$X" / "Savings" = discount info — skip entirely
- "SUBTOTAL", "TAX", "TOTAL", "VISA CHARGE", "AUTH CODE" = skip
- Letters after price (NF, F, T, WIC) = tax codes, not part of the name

For quantities like "3 @ $1.00 ea": quantity=3, price=3.00 (the TOTAL for all 3)

CATEGORIES (use exactly):
"Fruits" | "Légumes" | "Viandes & Poissons" | "Produits Laitiers" | "Boulangerie & Pâtisserie" | "Boissons" | "Épicerie Sèche" | "Surgelés" | "Hygiène & Beauté" | "Entretien Maison" | "Santé" | "Snacks & Confiseries" | "Autres"

BRAND RECOGNITION:
KASHI → Épicerie Sèche | CHOBANI → Produits Laitiers | CENTO → Épicerie Sèche | BARILLA/PASTA → Épicerie Sèche | LAURA'S LEAN → Viandes & Poissons | SIMPLY/TROPICANA → Boissons | CHIPS/DORITOS → Snacks & Confiseries

Date format must be YYYY-MM-DD. Use ${new Date().toISOString().split('T')[0]} if not readable.`;

/* ── ANALYZE ── */
app.post('/api/analyze', auth, upload.single('image'), async (req, res) => {
  try {
    let imgData, mediaType;
    if (req.file) {
      imgData = req.file.buffer.toString('base64'); mediaType = req.file.mimetype;
    } else if (req.body.imageBase64) {
      const m = req.body.imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      imgData = m ? m[2] : req.body.imageBase64; mediaType = m ? m[1] : 'image/jpeg';
    } else return res.status(400).json({ error: 'Aucune image fournie' });

    const response = await mistral.chat.complete({
      model: 'pixtral-12b-2409',
      maxTokens: 4096,
      temperature: 0.05,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', imageUrl: `data:${mediaType};base64,${imgData}` },
          { type: 'text',      text: PROMPT }
        ]
      }]
    });

    let rawText = response.choices[0].message.content.trim();
    console.log('PIXTRAL RAW:', rawText.slice(0, 400));

    // Robustly extract the first complete JSON object
    const start = rawText.indexOf('{');
    if (start === -1) throw new Error('Réponse illisible — réessayez avec une photo plus nette');
    let depth = 0, end = -1;
    for (let i = start; i < rawText.length; i++) {
      if (rawText[i] === '{') depth++;
      else if (rawText[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error('JSON incomplet dans la réponse');
    const data = JSON.parse(rawText.slice(start, end + 1));

    // Support alternative keys (items / products / line_items)
    if (!data.items && data.products)   data.items = data.products;
    if (!data.items && data.line_items) data.items = data.line_items;
    if (!Array.isArray(data.items))     data.items = [];

    // Normalize every item — handle string prices like "$5.79"
    data.items = data.items.map(i => ({
      name:     String(i.name || '').trim(),
      price:    parseFloat(String(i.price  || '0').replace(/[^0-9.]/g, '')) || 0,
      quantity: parseInt(String(i.quantity || '1').replace(/[^0-9]/g, ''))  || 1,
      category: i.category || 'Autres',
    })).filter(i => i.name.length > 0);  // only remove nameless items

    // Normalize total
    if (data.total) data.total = parseFloat(String(data.total).replace(/[^0-9.]/g, '')) || 0;

    // Normalize date to YYYY-MM-DD (handle "Mar 10, 2026", "10/03/2026", etc.)
    if (data.date) {
      try {
        const d = new Date(data.date);
        data.date = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      } catch { data.date = new Date().toISOString().split('T')[0]; }
    }

    if (data.items.length === 0) {
      throw new Error('Aucun article trouvé. Prenez la photo plus près et assurez-vous que le ticket est bien éclairé.');
    }

    res.json({ success: true, data });
  } catch (e) {
    console.error('analyze error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ── RECEIPTS ── */
app.post('/api/receipts', auth, (req, res) => {
  const list = loadRec(req.user.id);
  const rec  = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString() };
  list.push(rec);
  saveRec(req.user.id, list);
  res.json({ success: true, data: rec });
});

app.get('/api/receipts',        auth, (req, res) => res.json(loadRec(req.user.id)));
app.delete('/api/receipts/:id', auth, (req, res) => { saveRec(req.user.id, loadRec(req.user.id).filter(r => r.id !== req.params.id)); res.json({ success: true }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ ReceiptIQ v2 → http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY)  console.warn('⚠️  GROQ_API_KEY manquante');
  if (!process.env.JWT_SECRET)    console.warn('⚠️  JWT_SECRET non défini (utilise la valeur par défaut)');
});
