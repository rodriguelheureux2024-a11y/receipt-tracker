const express  = require('express');
const multer   = require('multer');
const Groq     = require('groq-sdk');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });
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
const PROMPT = `You are a receipt OCR expert. Analyze this receipt image carefully and return a JSON object.

RESPOND WITH VALID JSON ONLY — no markdown, no explanation.

{
  "store": "exact store name from receipt",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "items": [
    { "name": "product name", "price": 0.00, "quantity": 1, "category": "category" }
  ]
}

READING RULES:
- Store name: look at the very top of the receipt (logo text, header)
- Each item line has: [barcode] PRODUCT_NAME [tax_code] $PRICE
- Tax codes after price (NF, F, T, N, WIC) = NOT part of the name, ignore them
- "Regular Price $X.XX" lines = old price, NOT an item — skip
- "Save $X" / "6for$X" / "Savings" / discount lines = NOT items — skip
- "SUBTOTAL", "TAX", "TOTAL", "VISA", "AUTH CODE" = NOT items — skip
- Quantity: "3 @ $1.00 ea" means quantity=3 and price=3.00 (total for the line)

CATEGORIES (use exact text):
"Fruits" | "Légumes" | "Viandes & Poissons" | "Produits Laitiers" | "Boulangerie & Pâtisserie" | "Boissons" | "Épicerie Sèche" | "Surgelés" | "Hygiène & Beauté" | "Entretien Maison" | "Santé" | "Snacks & Confiseries" | "Autres"

BRAND GUIDE:
KASHI=Épicerie Sèche | CHOBANI=Produits Laitiers | GO PASTA/BARILLA/PANZANI=Épicerie Sèche | LAURA'S LEAN/GROUND BEEF=Viandes & Poissons | SIMPLY/TROPICANA/OJ=Boissons | CHIPS/DORITOS/LAYS=Snacks & Confiseries | TIDE/DAWN/LYSOL=Entretien Maison | ADVIL/TYLENOL=Santé | YOGURT/MILK/CHEESE=Produits Laitiers | APPLE/BANANA/ORANGE=Fruits | CARROT/LETTUCE/TOMATO=Légumes

Return today's date ${new Date().toISOString().split('T')[0]} if date not visible.`;

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

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 3000,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imgData}` } },
          { type: 'text', text: PROMPT }
        ]
      }]
    });

    let text = response.choices[0].message.content.trim();
    const data = JSON.parse(text);
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
